"""Telegram channel implementation using python-telegram-bot (long polling)."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from loguru import logger

from channels.base import BaseChannel
from message.events import InboundMessage
from message.queue_manager import get_inbound_queue

try:
    from telegram import BotCommand, Update, ReplyParameters
    from telegram.ext import (
        Application,
        CommandHandler,
        MessageHandler,
        filters,
        ContextTypes,
    )
    from telegram.request import HTTPXRequest

    TELEGRAM_AVAILABLE = True
except ImportError:
    TELEGRAM_AVAILABLE = False
    Update = None  # type: ignore[assignment,misc]
    ContextTypes = None  # type: ignore[assignment,misc]


def _markdown_to_telegram_html(text: str) -> str:
    """Convert markdown to Telegram-safe HTML."""
    if not text:
        return ""

    code_blocks: list[str] = []
    def _save_code_block(m: re.Match) -> str:
        code_blocks.append(m.group(1))
        return f"\x00CB{len(code_blocks) - 1}\x00"
    text = re.sub(r'```[\w]*\n?([\s\S]*?)```', _save_code_block, text)

    inline_codes: list[str] = []
    def _save_inline_code(m: re.Match) -> str:
        inline_codes.append(m.group(1))
        return f"\x00IC{len(inline_codes) - 1}\x00"
    text = re.sub(r'`([^`]+)`', _save_inline_code, text)

    text = re.sub(r'^#{1,6}\s+(.+)$', r'\1', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s*(.*)$', r'\1', text, flags=re.MULTILINE)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'__(.+?)__', r'<b>\1</b>', text)
    text = re.sub(r'(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])', r'<i>\1</i>', text)
    text = re.sub(r'~~(.+?)~~', r'<s>\1</s>', text)
    text = re.sub(r'^[-*]\s+', '• ', text, flags=re.MULTILINE)

    for i, code in enumerate(inline_codes):
        escaped = code.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        text = text.replace(f"\x00IC{i}\x00", f"<code>{escaped}</code>")
    for i, code in enumerate(code_blocks):
        escaped = code.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        text = text.replace(f"\x00CB{i}\x00", f"<pre><code>{escaped}</code></pre>")

    return text


def _split_message(content: str, max_len: int = 4000) -> list[str]:
    """Split content into chunks within max_len, preferring line breaks."""
    if len(content) <= max_len:
        return [content]
    chunks: list[str] = []
    while content:
        if len(content) <= max_len:
            chunks.append(content)
            break
        cut = content[:max_len]
        pos = cut.rfind('\n')
        if pos == -1:
            pos = cut.rfind(' ')
        if pos == -1:
            pos = max_len
        chunks.append(content[:pos])
        content = content[pos:].lstrip()
    return chunks


class TelegramChannel(BaseChannel):
    """Telegram channel using long polling.

    settings:
        token            : Telegram Bot Token
        proxy            : SOCKS5/HTTP proxy URL (optional)
        reply_to_message : 是否引用回复原消息 (default: true)
    """

    BOT_COMMANDS: list | None = None

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key
        self._token: str = settings.get("token", "")
        self._proxy: str = settings.get("proxy", "")
        self._reply_to_message: bool = bool(settings.get("reply_to_message", True))

        self._app: Application | None = None  # type: ignore[type-arg]
        self._chat_ids: dict[str, int] = {}
        self._typing_tasks: dict[str, asyncio.Task] = {}
        self._message_id_cache: dict[str, int] = {}
        self._main_task: asyncio.Task | None = None
        self._running = False

        if TELEGRAM_AVAILABLE:
            self.BOT_COMMANDS = [
                BotCommand("start", "Start the bot"),
                BotCommand("new", "Start a new conversation"),
                BotCommand("help", "Show available commands"),
            ]

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if not TELEGRAM_AVAILABLE:
            logger.error("[{}] python-telegram-bot 未安装，运行: pip install python-telegram-bot", self.name)
            return
        if not self._token:
            logger.error("[{}] Telegram bot token 未配置", self.name)
            return

        self._running = True

        req = HTTPXRequest(connection_pool_size=16, pool_timeout=5.0, connect_timeout=30.0, read_timeout=30.0)
        builder = Application.builder().token(self._token).request(req).get_updates_request(req)
        if self._proxy:
            builder = builder.proxy(self._proxy).get_updates_proxy(self._proxy)
        self._app = builder.build()
        self._app.add_error_handler(self._on_error)

        self._app.add_handler(CommandHandler("start", self._on_start))
        self._app.add_handler(CommandHandler("new", self._forward_command))
        self._app.add_handler(CommandHandler("help", self._on_help))
        self._app.add_handler(
            MessageHandler(
                (filters.TEXT | filters.PHOTO | filters.VOICE | filters.AUDIO | filters.Document.ALL)
                & ~filters.COMMAND,
                self._on_message,
            )
        )

        logger.info("[{}] Telegram bot 启动中（polling 模式）...", self.name)

        await self._app.initialize()
        await self._app.start()

        bot_info = await self._app.bot.get_me()
        logger.info("[{}] Telegram bot @{} 已连接", self.name, bot_info.username)

        try:
            if self.BOT_COMMANDS:
                await self._app.bot.set_my_commands(self.BOT_COMMANDS)
        except Exception as e:
            logger.warning("[{}] 注册 bot commands 失败: {}", self.name, e)

        await self._app.updater.start_polling(
            allowed_updates=["message"],
            drop_pending_updates=True,
        )

        self._main_task = asyncio.create_task(self._run_main())
        logger.info("[{}] Telegram channel 已启动", self.name)

    async def _run_main(self) -> None:
        while self._running:
            await asyncio.sleep(1)

    async def stop(self) -> None:
        self._running = False

        for chat_id in list(self._typing_tasks):
            self._stop_typing(chat_id)

        if self._main_task:
            self._main_task.cancel()
            try:
                await self._main_task
            except asyncio.CancelledError:
                pass

        if self._app:
            logger.info("[{}] Telegram bot 停止中...", self.name)
            try:
                await self._app.updater.stop()
                await self._app.stop()
                await self._app.shutdown()
            except Exception as e:
                logger.warning("[{}] Telegram bot 关闭异常: {}", self.name, e)
            self._app = None

        logger.info("[{}] Telegram channel 已停止", self.name)

    # ── 出站：发送消息 ────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._app:
            logger.warning("[{}] Telegram bot 未运行", self.name)
            return

        self._stop_typing(chat_id)

        try:
            int_chat_id = int(chat_id)
        except ValueError:
            logger.error("[{}] 无效 chat_id: {}", self.name, chat_id)
            return

        reply_params = None
        if self._reply_to_message:
            msg_id = self._message_id_cache.get(chat_id)
            if msg_id:
                reply_params = ReplyParameters(
                    message_id=msg_id,
                    allow_sending_without_reply=True,
                )

        if not content or content == "[empty message]":
            return

        for chunk in _split_message(content):
            try:
                html = _markdown_to_telegram_html(chunk)
                await self._app.bot.send_message(
                    chat_id=int_chat_id,
                    text=html,
                    parse_mode="HTML",
                    reply_parameters=reply_params,
                )
            except Exception:
                try:
                    await self._app.bot.send_message(
                        chat_id=int_chat_id,
                        text=chunk,
                        reply_parameters=reply_params,
                    )
                except Exception as e2:
                    logger.error("[{}] 发送 Telegram 消息失败: {}", self.name, e2)

    # ── 入站：事件处理 ────────────────────────────────────────────────────────

    async def _on_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[name-defined]
        if not update.message or not update.effective_user:
            return
        user = update.effective_user
        await update.message.reply_text(
            f"Hi {user.first_name}!\n\n"
            "Send me a message and I'll respond!\n"
            "Type /help to see available commands."
        )

    async def _on_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[name-defined]
        if not update.message:
            return
        await update.message.reply_text(
            "Available commands:\n"
            "/new — Start a new conversation\n"
            "/help — Show available commands"
        )

    @staticmethod
    def _sender_id(user) -> str:  # type: ignore[no-untyped-def]
        sid = str(user.id)
        return f"{sid}|{user.username}" if user.username else sid

    async def _forward_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[name-defined]
        if not update.message or not update.effective_user:
            return

        chat_id = str(update.message.chat_id)
        sender_id = self._sender_id(update.effective_user)

        self._message_id_cache[chat_id] = update.message.message_id

        session_id = f"{self.name}@{chat_id}"
        await get_inbound_queue().put(InboundMessage(
            session_id=session_id,
            content=update.message.text or "",
            metadata={
                "sender_id": sender_id,
                "message_id": update.message.message_id,
            },
        ))

    async def _on_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[name-defined]
        if not update.message or not update.effective_user:
            return

        message = update.message
        user = update.effective_user
        chat_id = str(message.chat_id)
        sender_id = self._sender_id(user)

        self._chat_ids[sender_id] = message.chat_id
        self._message_id_cache[chat_id] = message.message_id

        content_parts: list[str] = []

        if message.text:
            content_parts.append(message.text)
        if message.caption:
            content_parts.append(message.caption)

        media_file = None
        media_type = None
        if message.photo:
            media_file = message.photo[-1]
            media_type = "image"
        elif message.voice:
            media_file = message.voice
            media_type = "voice"
        elif message.audio:
            media_file = message.audio
            media_type = "audio"
        elif message.document:
            media_file = message.document
            media_type = "file"

        if media_file and self._app:
            try:
                file = await self._app.bot.get_file(media_file.file_id)
                ext = self._get_extension(media_type or "", getattr(media_file, 'mime_type', None))
                media_dir = Path.home() / ".aurogen" / "media"
                media_dir.mkdir(parents=True, exist_ok=True)
                file_path = media_dir / f"{media_file.file_id[:16]}{ext}"
                await file.download_to_drive(str(file_path))
                content_parts.append(f"[{media_type}: {file_path}]")
                logger.debug("[{}] 下载媒体 {} -> {}", self.name, media_type, file_path)
            except Exception as e:
                logger.error("[{}] 下载媒体失败: {}", self.name, e)
                content_parts.append(f"[{media_type}: download failed]")

        content = "\n".join(content_parts) if content_parts else "[empty message]"
        logger.debug("[{}] 收到消息 from {}: {}...", self.name, sender_id, content[:50])

        self._start_typing(chat_id)

        session_id = f"{self.name}@{chat_id}"
        await get_inbound_queue().put(InboundMessage(
            session_id=session_id,
            content=content,
            metadata={
                "sender_id": sender_id,
                "message_id": message.message_id,
                "user_id": user.id,
                "username": user.username,
                "first_name": user.first_name,
                "is_group": message.chat.type != "private",
            },
        ))

    # ── Typing indicator ──────────────────────────────────────────────────────

    def _start_typing(self, chat_id: str) -> None:
        self._stop_typing(chat_id)
        self._typing_tasks[chat_id] = asyncio.create_task(self._typing_loop(chat_id))

    def _stop_typing(self, chat_id: str) -> None:
        task = self._typing_tasks.pop(chat_id, None)
        if task and not task.done():
            task.cancel()

    async def _typing_loop(self, chat_id: str) -> None:
        try:
            while self._app:
                await self._app.bot.send_chat_action(chat_id=int(chat_id), action="typing")
                await asyncio.sleep(4)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("[{}] Typing indicator stopped for {}: {}", self.name, chat_id, e)

    async def _on_error(self, update: object, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[name-defined]
        logger.error("[{}] Telegram error: {}", self.name, context.error)

    # ── 工具方法 ──────────────────────────────────────────────────────────────

    @staticmethod
    def _get_media_type(path: str) -> str:
        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if ext in ("jpg", "jpeg", "png", "gif", "webp"):
            return "photo"
        if ext == "ogg":
            return "voice"
        if ext in ("mp3", "m4a", "wav", "aac"):
            return "audio"
        return "document"

    @staticmethod
    def _get_extension(media_type: str, mime_type: str | None) -> str:
        if mime_type:
            ext_map = {
                "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
                "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
            }
            if mime_type in ext_map:
                return ext_map[mime_type]
        type_map = {"image": ".jpg", "voice": ".ogg", "audio": ".mp3", "file": ""}
        return type_map.get(media_type, "")
