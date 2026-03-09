"""Slack channel implementation using Socket Mode."""

import asyncio
import re
from typing import Any

from loguru import logger

from channels.base import BaseChannel
from message.events import InboundMessage
from message.queue_manager import get_inbound_queue

try:
    from slack_sdk.socket_mode.websockets import SocketModeClient
    from slack_sdk.socket_mode.request import SocketModeRequest
    from slack_sdk.socket_mode.response import SocketModeResponse
    from slack_sdk.web.async_client import AsyncWebClient

    SLACK_SDK_AVAILABLE = True
except ImportError:
    SLACK_SDK_AVAILABLE = False
    SocketModeClient = None  # type: ignore[assignment,misc]
    SocketModeRequest = None  # type: ignore[assignment,misc]
    SocketModeResponse = None  # type: ignore[assignment,misc]
    AsyncWebClient = None  # type: ignore[assignment,misc]

try:
    from slackify_markdown import slackify_markdown as _slackify_markdown

    SLACKIFY_AVAILABLE = True
except ImportError:
    SLACKIFY_AVAILABLE = False
    _slackify_markdown = None  # type: ignore[assignment]


class SlackChannel(BaseChannel):
    """Slack channel using Socket Mode.

    settings:
        bot_token        : Slack Bot Token (xoxb-...)
        app_token        : Slack App-Level Token (xapp-...)
        reply_in_thread  : 是否在线程中回复 (default: true)
        react_emoji      : 收到消息后添加的表情反应 (default: "eyes")
        dm_enabled       : 是否启用 DM (default: true)
        dm_policy        : DM 策略 "open" | "allowlist" (default: "open")
        dm_allow_from    : DM 白名单用户 ID 列表 (default: [])
        group_policy     : 群组策略 "open" | "mention" | "allowlist" (default: "mention")
        group_allow_from : 群组白名单 channel ID 列表 (default: [])
    """

    _TABLE_RE = re.compile(r"(?m)^\|.*\|$(?:\n\|[\s:|-]*\|$)(?:\n\|.*\|$)*")

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._bot_token: str = settings.get("bot_token", "")
        self._app_token: str = settings.get("app_token", "")
        self._reply_in_thread: bool = bool(settings.get("reply_in_thread", True))
        self._react_emoji: str = settings.get("react_emoji", "eyes")

        self._dm_enabled: bool = bool(settings.get("dm_enabled", True))
        self._dm_policy: str = settings.get("dm_policy", "open")
        self._dm_allow_from: list = settings.get("dm_allow_from", [])
        self._group_policy: str = settings.get("group_policy", "mention")
        self._group_allow_from: list = settings.get("group_allow_from", [])

        self._web_client: Any = None
        self._socket_client: Any = None
        self._bot_user_id: str | None = None
        self._main_task: asyncio.Task | None = None
        self._thread_ts_cache: dict[str, str] = {}
        self._channel_type_cache: dict[str, str] = {}
        self._running = False

    async def start(self) -> None:
        if not SLACK_SDK_AVAILABLE:
            logger.error("[{}] slack-sdk 未安装，运行: pip install slack-sdk", self.name)
            return

        if not self._bot_token or not self._app_token:
            logger.error("[{}] bot_token 或 app_token 未配置", self.name)
            return

        self._running = True
        self._web_client = AsyncWebClient(token=self._bot_token)
        self._socket_client = SocketModeClient(
            app_token=self._app_token,
            web_client=self._web_client,
        )
        self._socket_client.socket_mode_request_listeners.append(self._on_socket_request)

        try:
            auth = await self._web_client.auth_test()
            self._bot_user_id = auth.get("user_id")
            logger.info("[{}] Slack bot 已连接: {}", self.name, self._bot_user_id)
        except Exception as e:
            logger.warning("[{}] Slack auth_test 失败: {}", self.name, e)

        await self._socket_client.connect()
        self._main_task = asyncio.create_task(self._run_main())
        logger.info("[{}] Slack channel 已启动（Socket Mode）", self.name)

    async def _run_main(self) -> None:
        while self._running:
            await asyncio.sleep(1)

    async def stop(self) -> None:
        self._running = False
        if self._main_task:
            self._main_task.cancel()
            try:
                await self._main_task
            except asyncio.CancelledError:
                pass
        if self._socket_client:
            try:
                await self._socket_client.close()
            except Exception as e:
                logger.warning("[{}] Slack socket 关闭失败: {}", self.name, e)
            self._socket_client = None
        logger.info("[{}] Slack channel 已停止", self.name)

    # ── 出站：发送消息 ────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._web_client:
            logger.warning("[{}] Slack 客户端未初始化", self.name)
            return
        if not content or not content.strip():
            return

        try:
            thread_ts = self._thread_ts_cache.get(chat_id)
            channel_type = self._channel_type_cache.get(chat_id, "")
            use_thread = thread_ts and channel_type != "im"

            await self._web_client.chat_postMessage(
                channel=chat_id,
                text=self._to_mrkdwn(content),
                thread_ts=thread_ts if use_thread else None,
            )
        except Exception as e:
            logger.error("[{}] 发送 Slack 消息失败: {}", self.name, e)

    # ── 入站：Socket Mode 事件处理 ────────────────────────────────────────────

    async def _on_socket_request(
        self,
        client: Any,
        req: Any,
    ) -> None:
        if req.type != "events_api":
            return

        await client.send_socket_mode_response(
            SocketModeResponse(envelope_id=req.envelope_id)
        )

        payload = req.payload or {}
        event = payload.get("event") or {}
        event_type = event.get("type")

        if event_type not in ("message", "app_mention"):
            return

        sender_id = event.get("user")
        chat_id = event.get("channel")

        if event.get("subtype"):
            return
        if self._bot_user_id and sender_id == self._bot_user_id:
            return

        text = event.get("text") or ""
        if event_type == "message" and self._bot_user_id and f"<@{self._bot_user_id}>" in text:
            return

        if not sender_id or not chat_id:
            return

        channel_type = event.get("channel_type") or ""

        if not self._is_allowed(sender_id, chat_id, channel_type):
            return

        if channel_type != "im" and not self._should_respond_in_channel(event_type, text, chat_id):
            return

        text = self._strip_bot_mention(text)

        thread_ts = event.get("thread_ts")
        if self._reply_in_thread and not thread_ts:
            thread_ts = event.get("ts")

        if thread_ts:
            self._thread_ts_cache[chat_id] = thread_ts
        self._channel_type_cache[chat_id] = channel_type

        try:
            if self._web_client and event.get("ts"):
                await self._web_client.reactions_add(
                    channel=chat_id,
                    name=self._react_emoji,
                    timestamp=event.get("ts"),
                )
        except Exception:
            pass

        session_id = f"{self.name}@{chat_id}"
        await get_inbound_queue().put(InboundMessage(
            session_id=session_id,
            content=text,
            metadata={
                "sender_id": sender_id,
                "thread_ts": thread_ts,
                "channel_type": channel_type,
                "event_type": event_type,
            },
        ))

    # ── 访问控制 ──────────────────────────────────────────────────────────────

    def _is_allowed(self, sender_id: str, chat_id: str, channel_type: str) -> bool:
        if channel_type == "im":
            if not self._dm_enabled:
                return False
            if self._dm_policy == "allowlist":
                return sender_id in self._dm_allow_from
            return True

        if self._group_policy == "allowlist":
            return chat_id in self._group_allow_from
        return True

    def _should_respond_in_channel(self, event_type: str, text: str, chat_id: str) -> bool:
        if self._group_policy == "open":
            return True
        if self._group_policy == "mention":
            if event_type == "app_mention":
                return True
            return self._bot_user_id is not None and f"<@{self._bot_user_id}>" in text
        if self._group_policy == "allowlist":
            return chat_id in self._group_allow_from
        return False

    def _strip_bot_mention(self, text: str) -> str:
        if not text or not self._bot_user_id:
            return text
        return re.sub(rf"<@{re.escape(self._bot_user_id)}>\s*", "", text).strip()

    # ── Markdown -> Slack mrkdwn 转换 ─────────────────────────────────────────

    @classmethod
    def _to_mrkdwn(cls, text: str) -> str:
        if not text:
            return ""
        text = cls._TABLE_RE.sub(cls._convert_table, text)
        if SLACKIFY_AVAILABLE and _slackify_markdown:
            return _slackify_markdown(text)
        return text

    @staticmethod
    def _convert_table(match: re.Match) -> str:
        lines = [ln.strip() for ln in match.group(0).strip().splitlines() if ln.strip()]
        if len(lines) < 2:
            return match.group(0)
        headers = [h.strip() for h in lines[0].strip("|").split("|")]
        start = 2 if re.fullmatch(r"[|\s:\-]+", lines[1]) else 1
        rows: list[str] = []
        for line in lines[start:]:
            cells = [c.strip() for c in line.strip("|").split("|")]
            cells = (cells + [""] * len(headers))[: len(headers)]
            parts = [f"**{headers[i]}**: {cells[i]}" for i in range(len(headers)) if cells[i]]
            if parts:
                rows.append(" · ".join(parts))
        return "\n".join(rows)
