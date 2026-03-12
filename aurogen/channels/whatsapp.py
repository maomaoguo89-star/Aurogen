"""WhatsApp channel: send/receive WhatsApp messages via Node.js Bridge subprocess."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from loguru import logger

from channels.base import BaseChannel
from message.events import InboundMessage
from message.queue_manager import get_inbound_queue

BRIDGE_DIR = Path(__file__).parent / "bridge"
BRIDGE_ENTRY = BRIDGE_DIR / "dist" / "index.js"

try:
    import websockets
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    websockets = None  # type: ignore[assignment]


class WhatsAppChannel(BaseChannel):
    """
    WhatsApp channel; sends/receives messages via Node.js Bridge.

    Bridge uses @whiskeysockets/baileys for WhatsApp Web protocol.
    Python talks to Bridge over WebSocket (bidirectional).
    start() spawns the Bridge subprocess; stop() terminates it.

    settings:
        bridge_port  : Bridge WebSocket port (default 3001)
        bridge_token : Optional auth token
        auth_dir     : Baileys auth directory (default ~/.aurogen/whatsapp-auth)
    """

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._bridge_port: int = int(settings.get("bridge_port", 3001))
        self._bridge_token: str = settings.get("bridge_token", "")
        self._auth_dir: str = settings.get(
            "auth_dir",
            os.path.join(os.path.expanduser("~"), ".aurogen", "whatsapp-auth"),
        )

        self._ws = None
        self._connected = False
        self._running = False
        self._bridge_proc: subprocess.Popen | None = None
        self._listen_task: asyncio.Task | None = None
        self._qr_code: str | None = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if not WS_AVAILABLE:
            logger.error("[{}] websockets not installed, run: pip install websockets", self.name)
            return

        if not BRIDGE_ENTRY.exists():
            logger.error(
                "[{}] Bridge not built, {} not found. Run npm run build in channels/bridge/ first",
                self.name, BRIDGE_ENTRY,
            )
            return

        self._running = True
        await self._start_bridge()
        self._listen_task = asyncio.create_task(self._ws_loop())

    async def stop(self) -> None:
        self._running = False
        self._connected = False

        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
            self._listen_task = None

        if self._ws:
            await self._ws.close()
            self._ws = None

        await self._stop_bridge()

    # ── Outbound ──────────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._ws or not self._connected:
            logger.warning("[{}] Bridge not connected, message dropped", self.name)
            return
        try:
            payload = {"type": "send", "to": chat_id, "text": content}
            await self._ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.error("[{}] Failed to send message: {}", self.name, e)

    # ── Bridge subprocess management ──────────────────────────────────────────

    async def _start_bridge(self) -> None:
        env = {**os.environ, "BRIDGE_PORT": str(self._bridge_port), "AUTH_DIR": self._auth_dir}
        if self._bridge_token:
            env["BRIDGE_TOKEN"] = self._bridge_token

        node_cmd = "node.exe" if sys.platform == "win32" else "node"
        logger.info("[{}] Starting Bridge subprocess (port={})...", self.name, self._bridge_port)
        self._bridge_proc = subprocess.Popen(
            [node_cmd, str(BRIDGE_ENTRY)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        asyncio.create_task(self._pipe_bridge_logs())
        await asyncio.sleep(2)

    async def _stop_bridge(self) -> None:
        proc = self._bridge_proc
        if proc is None:
            return
        self._bridge_proc = None
        try:
            proc.terminate()
            try:
                await asyncio.to_thread(proc.wait, timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                await asyncio.to_thread(proc.wait)
            logger.info("[{}] Bridge subprocess terminated", self.name)
        except ProcessLookupError:
            pass

    async def _pipe_bridge_logs(self) -> None:
        """Forward Bridge subprocess stdout/stderr to loguru."""
        proc = self._bridge_proc
        if proc is None:
            return

        def _read_stream(stream, level: str) -> None:
            for raw_line in stream:
                text = raw_line.decode(errors="replace").rstrip()
                if text:
                    logger.log(level, "[{}/bridge] {}", self.name, text)

        tasks = []
        if proc.stdout:
            tasks.append(asyncio.to_thread(_read_stream, proc.stdout, "INFO"))
        if proc.stderr:
            tasks.append(asyncio.to_thread(_read_stream, proc.stderr, "WARNING"))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ── WebSocket listen loop ─────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        bridge_url = f"ws://127.0.0.1:{self._bridge_port}"
        logger.info("[{}] Connecting to Bridge WebSocket {}...", self.name, bridge_url)

        while self._running:
            try:
                async with websockets.connect(bridge_url) as ws:
                    self._ws = ws
                    if self._bridge_token:
                        await ws.send(json.dumps({"type": "auth", "token": self._bridge_token}))
                    self._connected = True
                    logger.info("[{}] Connected to Bridge", self.name)

                    async for raw in ws:
                        try:
                            await self._handle_bridge_message(raw)
                        except Exception as e:
                            logger.error("[{}] Error handling bridge message: {}", self.name, e)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                self._ws = None
                if self._running:
                    logger.warning("[{}] Bridge connection lost: {}, reconnecting in 5s...", self.name, e)
                    await asyncio.sleep(5)

    # ── Inbound message handling ─────────────────────────────────────────────

    async def _handle_bridge_message(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[{}] Invalid JSON: {}", self.name, raw[:100])
            return

        msg_type = data.get("type")

        if msg_type == "message":
            pn = data.get("pn", "")
            sender = data.get("sender", "")
            content = data.get("content", "")

            user_id = pn if pn else sender
            sender_id = user_id.split("@")[0] if "@" in user_id else user_id
            logger.info("[{}] Received message sender={}", self.name, sender_id)

            if content == "[Voice Message]":
                content = "[Voice message: transcription not supported by WhatsApp]"

            session_id = f"{self.name}@{sender}"
            await get_inbound_queue().put(InboundMessage(
                session_id=session_id,
                content=content,
                metadata={
                    "message_id": data.get("id"),
                    "timestamp": data.get("timestamp"),
                    "is_group": data.get("isGroup", False),
                },
            ))

        elif msg_type == "status":
            status = data.get("status")
            logger.info("[{}] WhatsApp status: {}", self.name, status)
            if status == "connected":
                self._connected = True
                self._qr_code = None
            elif status == "disconnected":
                self._connected = False

        elif msg_type == "qr":
            self._qr_code = data.get("qr", "")
            logger.info("[{}] Received WhatsApp QR code, please scan via web panel to connect", self.name)

        elif msg_type == "error":
            logger.error("[{}] Bridge error: {}", self.name, data.get("error"))
