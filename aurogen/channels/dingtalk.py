"""DingTalk channel implementation using Stream Mode (dingtalk-stream SDK)."""

import asyncio
import json
import time
from typing import Any
from urllib.parse import quote_plus

import httpx
from loguru import logger

from channels.base import BaseChannel
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue

try:
    import websockets as _ws_lib
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    _ws_lib = None  # type: ignore[assignment]

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
                    "[{}] Received empty or unsupported message type: {}",
                    self.channel.name,
                    chatbot_msg.message_type,
                )
                return AckMessage.STATUS_OK, "OK"

            sender_id = chatbot_msg.sender_staff_id or chatbot_msg.sender_id
            sender_name = chatbot_msg.sender_nick or "Unknown"

            logger.info("[{}] Received message from {} ({}): {}", self.channel.name, sender_name, sender_id, content)

            task = asyncio.create_task(
                self.channel._on_message(content, sender_id, sender_name)
            )
            self.channel._background_tasks.add(task)
            task.add_done_callback(self.channel._background_tasks.discard)

            return AckMessage.STATUS_OK, "OK"

        except Exception as e:
            logger.error("[{}] Error processing DingTalk message: {}", self.channel.name, e)
            return AckMessage.STATUS_OK, "Error"


class DingTalkChannel(BaseChannel):
    """DingTalk channel using Stream Mode.

    Uses WebSocket to receive events via dingtalk-stream SDK.
    Uses direct HTTP API to send messages.

    settings:
        client_id     : DingTalk app Client ID (AppKey)
        client_secret : DingTalk app Client Secret (AppSecret)
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
        self._gateway_ws: Any = None
        self._background_tasks: set[asyncio.Task] = set()
        self._running = False

    async def start(self) -> None:
        if not DINGTALK_AVAILABLE:
            logger.error("[{}] dingtalk-stream not installed, run: pip install dingtalk-stream", self.name)
            return

        if not self._client_id or not self._client_secret:
            logger.error("[{}] client_id or client_secret not configured", self.name)
            return

        self._running = True
        self._http = httpx.AsyncClient()
        self._stream_task = asyncio.create_task(self._run_stream())
        logger.info("[{}] DingTalk bot started (Stream mode)", self.name)

    def _build_client(self) -> Any:
        credential = Credential(self._client_id, self._client_secret)
        client = DingTalkStreamClient(credential)
        handler = DingTalkHandler(self)
        client.register_callback_handler(ChatbotMessage.TOPIC, handler)
        client.pre_start()
        return client

    async def _run_stream(self) -> None:
        """Manage connection loop manually, bypassing SDK start() (which swallows CancelledError and cannot stop)."""
        self._client = self._build_client()
        while self._running:
            try:
                connection = await asyncio.to_thread(self._client.open_connection)
                if not connection:
                    logger.warning("[{}] DingTalk open_connection failed, retrying in 10 seconds", self.name)
                    await asyncio.sleep(10)
                    continue

                uri = f'{connection["endpoint"]}?ticket={quote_plus(connection["ticket"])}'
                async with _ws_lib.connect(uri) as ws:
                    self._gateway_ws = ws
                    self._client.websocket = ws
                    keepalive_task = asyncio.create_task(self._client.keepalive(ws))
                    try:
                        async for raw_message in ws:
                            if not self._running:
                                break
                            json_message = json.loads(raw_message)
                            asyncio.create_task(self._client.background_task(json_message))
                    finally:
                        keepalive_task.cancel()
                        self._gateway_ws = None
            except asyncio.CancelledError:
                break
            except Exception as e:
                if not self._running:
                    break
                logger.warning("[{}] DingTalk stream error: {}", self.name, e)
            if self._running:
                logger.info("[{}] Reconnecting DingTalk stream in 5 seconds...", self.name)
                await asyncio.sleep(5)

    async def stop(self) -> None:
        self._running = False
        if self._gateway_ws:
            try:
                await self._gateway_ws.close()
            except Exception:
                pass
            self._gateway_ws = None
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await asyncio.wait_for(self._stream_task, timeout=3)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        if self._http:
            await self._http.aclose()
            self._http = None
        for task in self._background_tasks:
            task.cancel()
        self._background_tasks.clear()
        logger.info("[{}] DingTalk bot stopped", self.name)

    # ── Outbound: send message ─────────────────────────────────────────────────

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
            logger.warning("[{}] HTTP client not initialized", self.name)
            return

        try:
            resp = await self._http.post(url, json=data, headers=headers)
            if resp.status_code != 200:
                logger.error("[{}] Failed to send DingTalk message: {}", self.name, resp.text)
        except Exception as e:
            logger.error("[{}] Error sending DingTalk message: {}", self.name, e)

    async def notify(self, event: AgentEvent) -> None:
        chat_id = event.session_id.split("@", 1)[1] if "@" in event.session_id else ""
        if not chat_id:
            return
        if event.event_type == EventType.THINKING:
            thinking = event.data.get("content", "")
            text = f"Thinking...\n{thinking[:300]}"
        elif event.event_type == EventType.TOOL_CALL:
            args_str = json.dumps(event.data.get("args", {}), ensure_ascii=False)
            text = f"Calling tool: {event.data.get('tool_name')}\nArgs: {args_str}"
        elif event.event_type == EventType.TOOL_RESULT:
            result = str(event.data.get("result", ""))
            text = f"Tool result: {event.data.get('tool_name')}\n{result[:300]}"
        else:
            return
        await self.send(chat_id, text)

    # ── Access Token management ───────────────────────────────────────────────

    async def _get_access_token(self) -> str | None:
        if self._access_token and time.time() < self._token_expiry:
            return self._access_token

        if not self._http:
            logger.warning("[{}] HTTP client not initialized, cannot refresh token", self.name)
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
            logger.error("[{}] Failed to get DingTalk access token: {}", self.name, e)
            return None

    # ── Inbound: receive message ──────────────────────────────────────────────

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
            logger.error("[{}] Error processing DingTalk inbound message: {}", self.name, e)
