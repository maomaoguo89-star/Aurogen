"""WhatsApp channel：通过 Node.js Bridge 子进程收发 WhatsApp 消息。"""

import asyncio
import json
import os
import signal
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
    WhatsApp channel，通过 Node.js Bridge 收发消息。

    Bridge 使用 @whiskeysockets/baileys 处理 WhatsApp Web 协议，
    Python 端通过 WebSocket 与 Bridge 双向通信。
    start() 会自动拉起 Bridge 子进程，stop() 时自动终止。

    settings:
        bridge_port  : Bridge WebSocket 端口（默认 3001）
        bridge_token : 可选认证 token
        auth_dir     : Baileys 认证目录（默认 ~/.aurogen/whatsapp-auth）
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
        self._bridge_proc: asyncio.subprocess.Process | None = None
        self._listen_task: asyncio.Task | None = None

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if not WS_AVAILABLE:
            logger.error("[{}] websockets 未安装，运行: pip install websockets", self.name)
            return

        if not BRIDGE_ENTRY.exists():
            logger.error(
                "[{}] Bridge 未构建，找不到 {}。请先在 channels/bridge/ 下执行 npm run build",
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

    # ── 出站 ──────────────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._ws or not self._connected:
            logger.warning("[{}] Bridge 未连接，消息丢弃", self.name)
            return
        try:
            payload = {"type": "send", "to": chat_id, "text": content}
            await self._ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.error("[{}] 发送消息失败: {}", self.name, e)

    # ── Bridge 子进程管理 ─────────────────────────────────────────────────────

    async def _start_bridge(self) -> None:
        env = {**os.environ, "BRIDGE_PORT": str(self._bridge_port), "AUTH_DIR": self._auth_dir}
        if self._bridge_token:
            env["BRIDGE_TOKEN"] = self._bridge_token

        logger.info("[{}] 启动 Bridge 子进程 (port={})...", self.name, self._bridge_port)
        self._bridge_proc = await asyncio.create_subprocess_exec(
            "node", str(BRIDGE_ENTRY),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.create_task(self._pipe_bridge_logs())
        await asyncio.sleep(2)

    async def _stop_bridge(self) -> None:
        proc = self._bridge_proc
        if proc is None:
            return
        self._bridge_proc = None
        try:
            proc.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
            logger.info("[{}] Bridge 子进程已终止", self.name)
        except ProcessLookupError:
            pass

    async def _pipe_bridge_logs(self) -> None:
        """将 Bridge 子进程的 stdout/stderr 转发到 loguru。"""
        proc = self._bridge_proc
        if proc is None:
            return

        async def _read_stream(stream, level: str):
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode(errors="replace").rstrip()
                if text:
                    logger.log(level, "[{}/bridge] {}", self.name, text)

        tasks = []
        if proc.stdout:
            tasks.append(asyncio.create_task(_read_stream(proc.stdout, "INFO")))
        if proc.stderr:
            tasks.append(asyncio.create_task(_read_stream(proc.stderr, "WARNING")))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ── WebSocket 监听循环 ────────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        bridge_url = f"ws://127.0.0.1:{self._bridge_port}"
        logger.info("[{}] 连接 Bridge WebSocket {}...", self.name, bridge_url)

        while self._running:
            try:
                async with websockets.connect(bridge_url) as ws:
                    self._ws = ws
                    if self._bridge_token:
                        await ws.send(json.dumps({"type": "auth", "token": self._bridge_token}))
                    self._connected = True
                    logger.info("[{}] 已连接 Bridge", self.name)

                    async for raw in ws:
                        try:
                            await self._handle_bridge_message(raw)
                        except Exception as e:
                            logger.error("[{}] 处理 bridge 消息出错: {}", self.name, e)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                self._ws = None
                if self._running:
                    logger.warning("[{}] Bridge 连接断开: {}，5 秒后重连...", self.name, e)
                    await asyncio.sleep(5)

    # ── 入站消息处理 ──────────────────────────────────────────────────────────

    async def _handle_bridge_message(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[{}] 无效 JSON: {}", self.name, raw[:100])
            return

        msg_type = data.get("type")

        if msg_type == "message":
            pn = data.get("pn", "")
            sender = data.get("sender", "")
            content = data.get("content", "")

            user_id = pn if pn else sender
            sender_id = user_id.split("@")[0] if "@" in user_id else user_id
            logger.info("[{}] 收到消息 sender={}", self.name, sender_id)

            if content == "[Voice Message]":
                content = "[语音消息：WhatsApp 暂不支持转写]"

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
            logger.info("[{}] WhatsApp 状态: {}", self.name, status)
            if status == "connected":
                self._connected = True
            elif status == "disconnected":
                self._connected = False

        elif msg_type == "qr":
            logger.info("[{}] 请在 Bridge 终端扫描 QR 码连接 WhatsApp", self.name)

        elif msg_type == "error":
            logger.error("[{}] Bridge 错误: {}", self.name, data.get("error"))
