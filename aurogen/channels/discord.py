"""Discord channel implementation using Discord Gateway WebSocket."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

from channels.base import BaseChannel
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue

try:
    import websockets

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None  # type: ignore[assignment]


DISCORD_API_BASE = "https://discord.com/api/v10"
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_MESSAGE_LEN = 2000


def _split_message(content: str, max_len: int = MAX_MESSAGE_LEN) -> list[str]:
    """Split content into chunks within max_len, preferring line breaks."""
    if not content:
        return []
    if len(content) <= max_len:
        return [content]
    chunks: list[str] = []
    while content:
        if len(content) <= max_len:
            chunks.append(content)
            break
        cut = content[:max_len]
        pos = cut.rfind("\n")
        if pos <= 0:
            pos = cut.rfind(" ")
        if pos <= 0:
            pos = max_len
        chunks.append(content[:pos])
        content = content[pos:].lstrip()
    return chunks


class DiscordChannel(BaseChannel):
    """Discord channel using Gateway WebSocket.

    settings:
        token       : Discord Bot Token
        gateway_url : Gateway WebSocket URL (default: wss://gateway.discord.gg/?v=10&encoding=json)
        intents     : Gateway intents bitmask (default: 33281 = GUILDS|GUILD_MESSAGES|MESSAGE_CONTENT|DIRECT_MESSAGES)
    """

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._token: str = settings.get("token", "")
        self._gateway_url: str = settings.get(
            "gateway_url", "wss://gateway.discord.gg/?v=10&encoding=json"
        )
        self._intents: int = int(settings.get("intents", 33281))
        self._ws: Any = None
        self._seq: int | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._gateway_task: asyncio.Task | None = None
        self._typing_tasks: dict[str, asyncio.Task] = {}
        self._http: httpx.AsyncClient | None = None
        self._running = False

    async def start(self) -> None:
        if not WEBSOCKETS_AVAILABLE:
            logger.error("[{}] websockets not installed, run: pip install websockets", self.name)
            return

        if not self._token:
            logger.error("[{}] Discord bot token not configured", self.name)
            return

        self._running = True
        self._http = httpx.AsyncClient(timeout=30.0)
        self._gateway_task = asyncio.create_task(self._run_gateway())
        logger.info("[{}] Discord bot started", self.name)

    FATAL_CLOSE_CODES = {4004, 4010, 4011, 4012, 4013, 4014}

    async def _run_gateway(self) -> None:
        while self._running:
            try:
                async with websockets.connect(self._gateway_url) as ws:
                    self._ws = ws
                    await self._gateway_loop()
            except asyncio.CancelledError:
                break
            except Exception as e:
                code = getattr(e, "code", None) if hasattr(e, "code") else None
                if code in self.FATAL_CLOSE_CODES:
                    logger.error(
                        "[{}] Discord gateway fatal error (code={}): {}, stopped reconnecting",
                        self.name, code, e,
                    )
                    self._running = False
                    break
                logger.warning("[{}] Discord gateway exception: {}", self.name, e)
            if self._running:
                logger.info("[{}] Reconnecting to Discord gateway in 5 seconds...", self.name)
                await asyncio.sleep(5)

    async def stop(self) -> None:
        self._running = False
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        if self._gateway_task:
            self._gateway_task.cancel()
            try:
                await self._gateway_task
            except asyncio.CancelledError:
                pass
        for task in self._typing_tasks.values():
            task.cancel()
        self._typing_tasks.clear()
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._http:
            await self._http.aclose()
            self._http = None
        logger.info("[{}] Discord bot stopped", self.name)

    # ── Outbound: send message ────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._http:
            logger.warning("[{}] HTTP client not initialized", self.name)
            return
        if not content or not content.strip():
            return

        url = f"{DISCORD_API_BASE}/channels/{chat_id}/messages"
        headers = {"Authorization": f"Bot {self._token}"}

        try:
            chunks = _split_message(content)
            if not chunks:
                return
            for chunk in chunks:
                if not await self._send_payload(url, headers, {"content": chunk}):
                    break
        finally:
            await self._stop_typing(chat_id)

    async def notify(self, event: AgentEvent) -> None:
        chat_id = event.session_id.split("@", 1)[1] if "@" in event.session_id else ""
        if not chat_id:
            return
        if event.event_type == EventType.THINKING:
            await self._start_typing(chat_id)
        elif event.event_type == EventType.TOOL_CALL:
            await self._start_typing(chat_id)

    async def _send_payload(
        self, url: str, headers: dict[str, str], payload: dict[str, Any]
    ) -> bool:
        for attempt in range(3):
            try:
                response = await self._http.post(url, headers=headers, json=payload)
                if response.status_code == 429:
                    data = response.json()
                    retry_after = float(data.get("retry_after", 1.0))
                    logger.warning("[{}] Discord rate limited, retrying in {}s", self.name, retry_after)
                    await asyncio.sleep(retry_after)
                    continue
                response.raise_for_status()
                return True
            except Exception as e:
                if attempt == 2:
                    logger.error("[{}] Failed to send Discord message: {}", self.name, e)
                else:
                    await asyncio.sleep(1)
        return False

    # ── Gateway ───────────────────────────────────────────────────────────────

    async def _gateway_loop(self) -> None:
        if not self._ws:
            return

        async for raw in self._ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            op = data.get("op")
            event_type = data.get("t")
            seq = data.get("s")
            payload = data.get("d")

            if seq is not None:
                self._seq = seq

            if op == 10:
                interval_ms = payload.get("heartbeat_interval", 45000)
                await self._start_heartbeat(interval_ms / 1000)
                await self._identify()
            elif op == 0 and event_type == "READY":
                logger.info("[{}] Discord gateway READY", self.name)
            elif op == 0 and event_type == "MESSAGE_CREATE":
                await self._handle_message_create(payload)
            elif op in (7, 9):
                logger.info("[{}] Discord gateway requested reconnect (op={})", self.name, op)
                break

    async def _identify(self) -> None:
        if not self._ws:
            return
        identify = {
            "op": 2,
            "d": {
                "token": self._token,
                "intents": self._intents,
                "properties": {
                    "os": "aurogen",
                    "browser": "aurogen",
                    "device": "aurogen",
                },
            },
        }
        await self._ws.send(json.dumps(identify))

    async def _start_heartbeat(self, interval_s: float) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()

        async def heartbeat_loop() -> None:
            while self._running and self._ws:
                payload = {"op": 1, "d": self._seq}
                try:
                    await self._ws.send(json.dumps(payload))
                except Exception as e:
                    logger.warning("[{}] Discord heartbeat failed: {}", self.name, e)
                    break
                await asyncio.sleep(interval_s)

        self._heartbeat_task = asyncio.create_task(heartbeat_loop())

    # ── Inbound: receive message ─────────────────────────────────────────────

    async def _handle_message_create(self, payload: dict[str, Any]) -> None:
        author = payload.get("author") or {}
        if author.get("bot"):
            return

        sender_id = str(author.get("id", ""))
        channel_id = str(payload.get("channel_id", ""))
        content = payload.get("content") or ""

        if not sender_id or not channel_id:
            return

        content_parts = [content] if content else []
        media_paths: list[str] = []
        media_dir = Path.home() / ".aurogen" / "media"

        for attachment in payload.get("attachments") or []:
            url = attachment.get("url")
            filename = attachment.get("filename") or "attachment"
            size = attachment.get("size") or 0
            if not url or not self._http:
                continue
            if size and size > MAX_ATTACHMENT_BYTES:
                content_parts.append(f"[attachment: {filename} - too large]")
                continue
            try:
                media_dir.mkdir(parents=True, exist_ok=True)
                file_path = media_dir / f"{attachment.get('id', 'file')}_{filename.replace('/', '_')}"
                resp = await self._http.get(url)
                resp.raise_for_status()
                file_path.write_bytes(resp.content)
                media_paths.append(str(file_path))
                content_parts.append(f"[attachment: {file_path}]")
            except Exception as e:
                logger.warning("[{}] Failed to download Discord attachment: {}", self.name, e)
                content_parts.append(f"[attachment: {filename} - download failed]")

        await self._start_typing(channel_id)

        session_id = f"{self.name}@{channel_id}"
        await get_inbound_queue().put(InboundMessage(
            session_id=session_id,
            content="\n".join(p for p in content_parts if p) or "[empty message]",
            metadata={
                "sender_id": sender_id,
                "message_id": str(payload.get("id", "")),
                "guild_id": payload.get("guild_id"),
                "media": media_paths,
            },
        ))

    # ── Typing indicator ─────────────────────────────────────────────────────

    async def _start_typing(self, channel_id: str) -> None:
        await self._stop_typing(channel_id)

        async def typing_loop() -> None:
            url = f"{DISCORD_API_BASE}/channels/{channel_id}/typing"
            headers = {"Authorization": f"Bot {self._token}"}
            while self._running:
                try:
                    if self._http:
                        await self._http.post(url, headers=headers)
                except Exception:
                    pass
                await asyncio.sleep(8)

        self._typing_tasks[channel_id] = asyncio.create_task(typing_loop())

    async def _stop_typing(self, channel_id: str) -> None:
        task = self._typing_tasks.pop(channel_id, None)
        if task:
            task.cancel()
