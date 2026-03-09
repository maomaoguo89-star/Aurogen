"""DingTalk channel implementation using Stream Mode (dingtalk-stream SDK)."""

import asyncio
import json
import time
from typing import Any

import httpx
from loguru import logger

from channels.base import BaseChannel
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue

try:
    from dingtalk_stream import (
        DingTalkStreamClient,
        Credential,
        CallbackHandler,
        CallbackMessage,
        AckMessage,
    )
    from dingtalk_stream.chatbot import ChatbotMessage

    DINGTALK_AVAILABLE = True
except ImportError:
    DINGTALK_AVAILABLE = False
    CallbackHandler = object  # type: ignore[assignment,misc]
    CallbackMessage = None  # type: ignore[assignment,misc]
    AckMessage = None  # type: ignore[assignment,misc]
    ChatbotMessage = None  # type: ignore[assignment,misc]


class DingTalkHandler(CallbackHandler):
    """DingTalk Stream SDK callback handler."""

    def __init__(self, channel: "DingTalkChannel"):
        super().__init__()
        self.channel = channel

    async def process(self, message: CallbackMessage):
        try:
            chatbot_msg = ChatbotMessage.from_dict(message.data)

            content = ""
            if chatbot_msg.text:
                content = chatbot_msg.text.content.strip()
            if not content:
                content = message.data.get("text", {}).get("content", "").strip()

            if not content:
                logger.warning(
                    "[{}] 收到空消息或不支持的消息类型: {}",
                    self.channel.name,
                    chatbot_msg.message_type,
                )
                return AckMessage.STATUS_OK, "OK"

            sender_id = chatbot_msg.sender_staff_id or chatbot_msg.sender_id
            sender_name = chatbot_msg.sender_nick or "Unknown"

            logger.info("[{}] 收到消息 from {} ({}): {}", self.channel.name, sender_name, sender_id, content)

            task = asyncio.create_task(
                self.channel._on_message(content, sender_id, sender_name)
            )
            self.channel._background_tasks.add(task)
            task.add_done_callback(self.channel._background_tasks.discard)

            return AckMessage.STATUS_OK, "OK"

        except Exception as e:
            logger.error("[{}] 处理钉钉消息异常: {}", self.channel.name, e)
            return AckMessage.STATUS_OK, "Error"


class DingTalkChannel(BaseChannel):
    """DingTalk channel using Stream Mode.

    Uses WebSocket to receive events via dingtalk-stream SDK.
    Uses direct HTTP API to send messages.

    settings:
        client_id     : 钉钉应用 Client ID (AppKey)
        client_secret : 钉钉应用 Client Secret (AppSecret)
    """

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._client_id: str = settings.get("client_id", "")
        self._client_secret: str = settings.get("client_secret", "")
        self._client: Any = None
        self._http: httpx.AsyncClient | None = None
        self._access_token: str | None = None
        self._token_expiry: float = 0
        self._stream_task: asyncio.Task | None = None
        self._background_tasks: set[asyncio.Task] = set()
        self._running = False

    async def start(self) -> None:
        if not DINGTALK_AVAILABLE:
            logger.error("[{}] dingtalk-stream 未安装，运行: pip install dingtalk-stream", self.name)
            return

        if not self._client_id or not self._client_secret:
            logger.error("[{}] client_id 或 client_secret 未配置", self.name)
            return

        self._running = True
        self._http = httpx.AsyncClient()

        credential = Credential(self._client_id, self._client_secret)
        self._client = DingTalkStreamClient(credential)

        handler = DingTalkHandler(self)
        self._client.register_callback_handler(ChatbotMessage.TOPIC, handler)

        self._stream_task = asyncio.create_task(self._run_stream())
        logger.info("[{}] 钉钉 bot 已启动（Stream 模式）", self.name)

    async def _run_stream(self) -> None:
        while self._running:
            try:
                await self._client.start()
            except Exception as e:
                logger.warning("[{}] 钉钉 stream 异常: {}", self.name, e)
            if self._running:
                logger.info("[{}] 5 秒后重连钉钉 stream...", self.name)
                await asyncio.sleep(5)

    async def stop(self) -> None:
        self._running = False
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await self._stream_task
            except asyncio.CancelledError:
                pass
        if self._http:
            await self._http.aclose()
            self._http = None
        for task in self._background_tasks:
            task.cancel()
        self._background_tasks.clear()
        logger.info("[{}] 钉钉 bot 已停止", self.name)

    # ── 出站：发送消息 ────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not content or not content.strip():
            return
        token = await self._get_access_token()
        if not token:
            return

        url = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"
        headers = {"x-acs-dingtalk-access-token": token}
        data = {
            "robotCode": self._client_id,
            "userIds": [chat_id],
            "msgKey": "sampleMarkdown",
            "msgParam": json.dumps({
                "text": content,
                "title": "Reply",
            }, ensure_ascii=False),
        }

        if not self._http:
            logger.warning("[{}] HTTP 客户端未初始化", self.name)
            return

        try:
            resp = await self._http.post(url, json=data, headers=headers)
            if resp.status_code != 200:
                logger.error("[{}] 发送钉钉消息失败: {}", self.name, resp.text)
        except Exception as e:
            logger.error("[{}] 发送钉钉消息异常: {}", self.name, e)

    async def notify(self, event: AgentEvent) -> None:
        chat_id = event.session_id.split("@", 1)[1] if "@" in event.session_id else ""
        if not chat_id:
            return
        if event.event_type == EventType.THINKING:
            thinking = event.data.get("content", "")
            text = f"思考中...\n{thinking[:300]}"
        elif event.event_type == EventType.TOOL_CALL:
            args_str = json.dumps(event.data.get("args", {}), ensure_ascii=False)
            text = f"调用工具: {event.data.get('tool_name')}\n参数: {args_str}"
        elif event.event_type == EventType.TOOL_RESULT:
            result = str(event.data.get("result", ""))
            text = f"工具结果: {event.data.get('tool_name')}\n{result[:300]}"
        else:
            return
        await self.send(chat_id, text)

    # ── Access Token 管理 ─────────────────────────────────────────────────────

    async def _get_access_token(self) -> str | None:
        if self._access_token and time.time() < self._token_expiry:
            return self._access_token

        if not self._http:
            logger.warning("[{}] HTTP 客户端未初始化，无法刷新 token", self.name)
            return None

        url = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
        data = {"appKey": self._client_id, "appSecret": self._client_secret}

        try:
            resp = await self._http.post(url, json=data)
            resp.raise_for_status()
            res_data = resp.json()
            self._access_token = res_data.get("accessToken")
            self._token_expiry = time.time() + int(res_data.get("expireIn", 7200)) - 60
            return self._access_token
        except Exception as e:
            logger.error("[{}] 获取钉钉 access token 失败: {}", self.name, e)
            return None

    # ── 入站：接收消息 ────────────────────────────────────────────────────────

    async def _on_message(self, content: str, sender_id: str, sender_name: str) -> None:
        try:
            session_id = f"{self.name}@{sender_id}"
            await get_inbound_queue().put(InboundMessage(
                session_id=session_id,
                content=content,
                metadata={
                    "sender_id": sender_id,
                    "sender_name": sender_name,
                    "platform": "dingtalk",
                },
            ))
        except Exception as e:
            logger.error("[{}] 处理钉钉入站消息异常: {}", self.name, e)
