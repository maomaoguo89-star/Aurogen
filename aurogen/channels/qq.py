"""QQ channel implementation using botpy SDK."""

import asyncio
import json
from collections import deque
from typing import TYPE_CHECKING, Any

from loguru import logger

from channels.base import BaseChannel
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue

try:
    import botpy
    from botpy.message import C2CMessage

    QQ_AVAILABLE = True
except ImportError:
    QQ_AVAILABLE = False
    botpy = None
    C2CMessage = None

if TYPE_CHECKING:
    from botpy.message import C2CMessage


def _make_bot_class(channel: "QQChannel") -> "type[botpy.Client]":
    """Create a botpy Client subclass bound to the given channel."""
    intents = botpy.Intents(public_messages=True, direct_message=True)

    class _Bot(botpy.Client):
        def __init__(self):
            super().__init__(intents=intents)

        async def on_ready(self):
            logger.info("[{}] QQ bot ready: {}", channel.name, self.robot.name)

        async def on_c2c_message_create(self, message: "C2CMessage"):
            await channel._on_message(message)

        async def on_direct_message_create(self, message):
            await channel._on_message(message)

    return _Bot


class QQChannel(BaseChannel):
    """QQ channel using botpy SDK with WebSocket connection.

    settings:
        app_id : QQ 机器人 App ID
        secret : QQ 机器人 App Secret
    """

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._app_id: str = settings.get("app_id", "")
        self._secret: str = settings.get("secret", "")
        self._client: Any = None
        self._processed_ids: deque = deque(maxlen=1000)
        self._bot_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if not QQ_AVAILABLE:
            logger.error("[{}] qq-botpy 未安装，运行: pip install qq-botpy", self.name)
            return

        if not self._app_id or not self._secret:
            logger.error("[{}] app_id 或 secret 未配置", self.name)
            return

        self._running = True
        BotClass = _make_bot_class(self)
        self._client = BotClass()

        self._bot_task = asyncio.create_task(self._run_bot())
        logger.info("[{}] QQ bot 已启动（C2C 私聊模式）", self.name)

    async def _run_bot(self) -> None:
        while self._running:
            try:
                await self._client.start(appid=self._app_id, secret=self._secret)
            except Exception as e:
                logger.warning("[{}] QQ bot 异常: {}", self.name, e)
            if self._running:
                logger.info("[{}] 5 秒后重连 QQ bot...", self.name)
                await asyncio.sleep(5)

    async def stop(self) -> None:
        self._running = False
        if self._bot_task:
            self._bot_task.cancel()
            try:
                await self._bot_task
            except asyncio.CancelledError:
                pass
        logger.info("[{}] QQ bot 已停止", self.name)

    # ── 出站：发送消息 ────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._client:
            logger.warning("[{}] QQ 客户端未初始化", self.name)
            return
        if not content or not content.strip():
            return
        try:
            await self._client.api.post_c2c_message(
                openid=chat_id,
                msg_type=0,
                content=content,
            )
        except Exception as e:
            logger.error("[{}] 发送 QQ 消息失败: {}", self.name, e)

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

    # ── 入站：接收消息 ────────────────────────────────────────────────────────

    async def _on_message(self, data: "C2CMessage") -> None:
        try:
            if data.id in self._processed_ids:
                return
            self._processed_ids.append(data.id)

            author = data.author
            user_id = str(getattr(author, "id", None) or getattr(author, "user_openid", "unknown"))
            content = (data.content or "").strip()
            if not content:
                return

            session_id = f"{self.name}@{user_id}"
            await get_inbound_queue().put(InboundMessage(
                session_id=session_id,
                content=content,
                metadata={"sender_id": user_id, "message_id": data.id},
            ))
        except Exception as e:
            logger.error("[{}] 处理 QQ 消息异常: {}", self.name, e)
