"""FeishuChannel: Feishu/Lark channel, sends and receives messages via WebSocket long connection."""

import asyncio
import json
import os
import re
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from loguru import logger

from channels.base import BaseChannel
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue

try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import (
        CreateFileRequest,
        CreateFileRequestBody,
        CreateImageRequest,
        CreateImageRequestBody,
        CreateMessageReactionRequest,
        CreateMessageReactionRequestBody,
        CreateMessageRequest,
        CreateMessageRequestBody,
        Emoji,
        GetMessageResourceRequest,
        P2ImMessageReceiveV1,
    )
    FEISHU_AVAILABLE = True
except ImportError:
    FEISHU_AVAILABLE = False
    lark = None
    Emoji = None

MSG_TYPE_MAP = {
    "image": "[image]",
    "audio": "[audio]",
    "file": "[file]",
    "sticker": "[sticker]",
}


class _ThreadLocalLoopProxy:
    """Thread-safe proxy for lark SDK's module-level ``loop`` variable.

    The lark-oapi SDK stores the asyncio event loop as a module-level global
    (``lark_oapi.ws.client.loop``). When multiple FeishuChannel instances each
    run a WS client in their own thread, they all overwrite that single global,
    causing cross-thread loop contamination.

    This proxy replaces the global with an object that delegates every attribute
    access to the *current thread's* event loop via ``threading.local``.
    """

    _tls = threading.local()

    @classmethod
    def set_loop(cls, loop: asyncio.AbstractEventLoop) -> None:
        cls._tls.loop = loop

    def __getattr__(self, name: str) -> Any:
        return getattr(self._tls.loop, name)


_loop_proxy = _ThreadLocalLoopProxy()


# ── Message content parsing helpers ──────────────────────────────────────────

def _extract_share_card_content(content_json: dict, msg_type: str) -> str:
    parts = []
    if msg_type == "share_chat":
        parts.append(f"[shared chat: {content_json.get('chat_id', '')}]")
    elif msg_type == "share_user":
        parts.append(f"[shared user: {content_json.get('user_id', '')}]")
    elif msg_type == "interactive":
        parts.extend(_extract_interactive_content(content_json))
    elif msg_type == "share_calendar_event":
        parts.append(f"[shared calendar event: {content_json.get('event_key', '')}]")
    elif msg_type == "system":
        parts.append("[system message]")
    elif msg_type == "merge_forward":
        parts.append("[merged forward messages]")
    return "\n".join(parts) if parts else f"[{msg_type}]"


def _extract_interactive_content(content: dict) -> list[str]:
    parts = []
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            return [content] if content.strip() else []
    if not isinstance(content, dict):
        return parts
    if "title" in content:
        title = content["title"]
        if isinstance(title, dict):
            t = title.get("content", "") or title.get("text", "")
            if t:
                parts.append(f"title: {t}")
        elif isinstance(title, str):
            parts.append(f"title: {title}")
    for elements in content.get("elements", []) if isinstance(content.get("elements"), list) else []:
        for element in elements:
            parts.extend(_extract_element_content(element))
    card = content.get("card", {})
    if card:
        parts.extend(_extract_interactive_content(card))
    header = content.get("header", {})
    if header:
        header_title = header.get("title", {})
        if isinstance(header_title, dict):
            t = header_title.get("content", "") or header_title.get("text", "")
            if t:
                parts.append(f"title: {t}")
    return parts


def _extract_element_content(element: dict) -> list[str]:
    parts = []
    if not isinstance(element, dict):
        return parts
    tag = element.get("tag", "")
    if tag in ("markdown", "lark_md"):
        c = element.get("content", "")
        if c:
            parts.append(c)
    elif tag == "div":
        text = element.get("text", {})
        if isinstance(text, dict):
            c = text.get("content", "") or text.get("text", "")
            if c:
                parts.append(c)
        elif isinstance(text, str):
            parts.append(text)
        for field in element.get("fields", []):
            if isinstance(field, dict):
                ft = field.get("text", {})
                if isinstance(ft, dict):
                    c = ft.get("content", "")
                    if c:
                        parts.append(c)
    elif tag == "a":
        href = element.get("href", "")
        text = element.get("text", "")
        if href:
            parts.append(f"link: {href}")
        if text:
            parts.append(text)
    elif tag == "button":
        text = element.get("text", {})
        if isinstance(text, dict):
            c = text.get("content", "")
            if c:
                parts.append(c)
        url = element.get("url", "") or element.get("multi_url", {}).get("url", "")
        if url:
            parts.append(f"link: {url}")
    elif tag == "img":
        alt = element.get("alt", {})
        parts.append(alt.get("content", "[image]") if isinstance(alt, dict) else "[image]")
    elif tag == "note":
        for ne in element.get("elements", []):
            parts.extend(_extract_element_content(ne))
    elif tag == "column_set":
        for col in element.get("columns", []):
            for ce in col.get("elements", []):
                parts.extend(_extract_element_content(ce))
    elif tag == "plain_text":
        c = element.get("content", "")
        if c:
            parts.append(c)
    else:
        for ne in element.get("elements", []):
            parts.extend(_extract_element_content(ne))
    return parts


def _extract_post_content(content_json: dict) -> tuple[str, list[str]]:
    def _parse_block(block: dict) -> tuple[str | None, list[str]]:
        if not isinstance(block, dict) or not isinstance(block.get("content"), list):
            return None, []
        texts, images = [], []
        if title := block.get("title"):
            texts.append(title)
        for row in block["content"]:
            if not isinstance(row, list):
                continue
            for el in row:
                if not isinstance(el, dict):
                    continue
                tag = el.get("tag")
                if tag in ("text", "a"):
                    texts.append(el.get("text", ""))
                elif tag == "at":
                    texts.append(f"@{el.get('user_name', 'user')}")
                elif tag == "img" and (key := el.get("image_key")):
                    images.append(key)
        return (" ".join(texts).strip() or None), images

    root = content_json
    if isinstance(root, dict) and isinstance(root.get("post"), dict):
        root = root["post"]
    if not isinstance(root, dict):
        return "", []
    if "content" in root:
        text, imgs = _parse_block(root)
        if text or imgs:
            return text or "", imgs
    for key in ("zh_cn", "en_us", "ja_jp"):
        if key in root:
            text, imgs = _parse_block(root[key])
            if text or imgs:
                return text or "", imgs
    for val in root.values():
        if isinstance(val, dict):
            text, imgs = _parse_block(val)
            if text or imgs:
                return text or "", imgs
    return "", []


# ── FeishuChannel ────────────────────────────────────────────────────────────

class FeishuChannel(BaseChannel):
    """
    Feishu channel: receives messages via WebSocket long connection, sends via HTTP API.

    settings (from config.channels.<key>.settings):
        app_id             : Feishu app App ID
        app_secret         : Feishu app App Secret
        encrypt_key        : Message encryption key (optional)
        verification_token : Verification token (optional)
        react_emoji        : Emoji reaction added automatically on receive, default "THUMBSUP"
    """

    _TABLE_RE = re.compile(
        r"((?:^[ \t]*\|.+\|[ \t]*\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n?)+)",
        re.MULTILINE,
    )
    _HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
    _CODE_BLOCK_RE = re.compile(r"(```[\s\S]*?```)", re.MULTILINE)
    _IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".tif"}
    _AUDIO_EXTS = {".opus"}
    _FILE_TYPE_MAP = {
        ".opus": "opus", ".mp4": "mp4", ".pdf": "pdf", ".doc": "doc", ".docx": "doc",
        ".xls": "xls", ".xlsx": "xls", ".ppt": "ppt", ".pptx": "ppt",
    }

    def __init__(self, channel_key: str, settings: dict):
        """
        channel_key : Key in config, also used as session_id prefix (e.g. "feishu_work")
        settings    : config.channels.<key>.settings dict
        """
        self.name = channel_key
        self._app_id: str = settings.get("app_id", "")
        self._app_secret: str = settings.get("app_secret", "")
        self._encrypt_key: str = settings.get("encrypt_key", "")
        self._verification_token: str = settings.get("verification_token", "")
        self._react_emoji: str = settings.get("react_emoji", "THUMBSUP")

        self._client: Any = None
        self._ws_client: Any = None
        self._ws_thread: threading.Thread | None = None
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._processed_message_ids: OrderedDict[str, None] = OrderedDict()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start Feishu WebSocket long connection (non-blocking, runs in background thread)."""
        if not FEISHU_AVAILABLE:
            logger.error("[{}] lark-oapi not installed, run: pip install lark-oapi", self.name)
            return
        if not self._app_id or not self._app_secret:
            logger.error("[{}] app_id or app_secret not configured", self.name)
            return

        self._running = True
        self._loop = asyncio.get_running_loop()

        # REST client: sync-only, created in main coroutine for send() / _add_reaction_sync() etc.
        self._client = (
            lark.Client.builder()
            .app_id(self._app_id)
            .app_secret(self._app_secret)
            .log_level(lark.LogLevel.INFO)
            .build()
        )

        # Pass WS client params into closure so WS client is not created on main thread
        # (lark ws.Client.__init__ creates asyncio.Lock, must be created on the loop that runs it)
        app_id = self._app_id
        app_secret = self._app_secret
        encrypt_key = self._encrypt_key
        verification_token = self._verification_token

        def _run_ws():
            import lark_oapi.ws.client as _lark_ws_module

            thread_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(thread_loop)
            _lark_ws_module.loop = _loop_proxy  # idempotent: always the same proxy
            _ThreadLocalLoopProxy.set_loop(thread_loop)

            event_handler = (
                lark.EventDispatcherHandler.builder(encrypt_key, verification_token)
                .register_p2_im_message_receive_v1(self._on_message_sync)
                .build()
            )
            ws_client = lark.ws.Client(
                app_id,
                app_secret,
                event_handler=event_handler,
                log_level=lark.LogLevel.INFO,
            )

            while self._running:
                try:
                    ws_client.start()  # Blocks until disconnect; lark auto-reconnects internally
                except Exception as e:
                    logger.warning("[{}] WebSocket error: {}", self.name, e)
                if self._running:
                    import time
                    time.sleep(5)

            thread_loop.close()

        self._ws_thread = threading.Thread(target=_run_ws, daemon=True)
        self._ws_thread.start()
        logger.info("[{}] Feishu channel started (WebSocket long connection)", self.name)

    async def stop(self) -> None:
        """Stop Feishu channel."""
        self._running = False
        logger.info("[{}] Feishu channel stopped", self.name)

    # ── Outbound: send message ─────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        """Send Feishu message to given chat_id (rendered as interactive card)."""
        if not self._client:
            logger.warning("[{}] Client not initialized", self.name)
            return
        if not content or not content.strip():
            return
        try:
            loop = asyncio.get_running_loop()
            card = {
                "config": {"wide_screen_mode": True},
                "elements": self._build_card_elements(content),
            }
            await loop.run_in_executor(
                None,
                self._send_message_sync,
                "chat_id" if chat_id.startswith("oc_") else "open_id",
                chat_id,
                "interactive",
                json.dumps(card, ensure_ascii=False),
            )
        except Exception as e:
            logger.error("[{}] Send message failed: {}", self.name, e)

    async def notify(self, event: AgentEvent) -> None:
        """Push intermediate events to Feishu user (THINKING/TOOL_CALL/TOOL_RESULT)."""
        chat_id = event.session_id.split("@", 1)[1] if "@" in event.session_id else ""
        if not chat_id:
            return
        if event.event_type == EventType.THINKING:
            thinking = event.data.get("content", "")
            text = f"💭 Thinking...\n{thinking[:300]}"
        elif event.event_type == EventType.TOOL_CALL:
            args_str = json.dumps(event.data.get("args", {}), ensure_ascii=False)
            text = f"🔧 Tool call: {event.data.get('tool_name')}\nArgs: {args_str}"
        elif event.event_type == EventType.TOOL_RESULT:
            result = str(event.data.get("result", ""))
            text = f"✅ Tool result: {event.data.get('tool_name')}\n{result[:300]}"
        else:
            return
        await self.send(chat_id, text)

    def _send_message_sync(
        self, receive_id_type: str, receive_id: str, msg_type: str, content: str,
        _max_retries: int = 3,
    ) -> bool:
        import time

        request = (
            CreateMessageRequest.builder()
            .receive_id_type(receive_id_type)
            .request_body(
                CreateMessageRequestBody.builder()
                .receive_id(receive_id)
                .msg_type(msg_type)
                .content(content)
                .build()
            )
            .build()
        )
        for attempt in range(_max_retries):
            try:
                response = self._client.im.v1.message.create(request)
                if not response.success():
                    logger.error("[{}] Send failed: code={}, msg={}", self.name, response.code, response.msg)
                    return False
                return True
            except Exception as e:
                if attempt < _max_retries - 1:
                    delay = 1 * (attempt + 1)
                    logger.warning("[{}] Send error (retry {}/{}): {}", self.name, attempt + 1, _max_retries, e)
                    time.sleep(delay)
                else:
                    logger.error("[{}] Send error (retried {} times): {}", self.name, _max_retries, e)
        return False

    # ── Inbound: receive message ──────────────────────────────────────────────

    def _on_message_sync(self, data: "P2ImMessageReceiveV1") -> None:
        """WebSocket thread sync callback, bridge to asyncio event loop."""
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._on_message(data), self._loop)

    async def _on_message(self, data: "P2ImMessageReceiveV1") -> None:
        """Handle inbound message, parse and put into inbound_queue."""
        try:
            event = data.event
            message = event.message
            sender = event.sender

            message_id = message.message_id

            # Deduplicate
            if message_id in self._processed_message_ids:
                return
            self._processed_message_ids[message_id] = None
            while len(self._processed_message_ids) > 1000:
                self._processed_message_ids.popitem(last=False)

            # Filter bot's own messages
            if sender.sender_type == "bot":
                return

            sender_id = sender.sender_id.open_id if sender.sender_id else "unknown"
            chat_id = message.chat_id
            chat_type = message.chat_type
            msg_type = message.message_type

            await self._add_reaction(message_id, self._react_emoji)

            # Parse message content
            content_parts: list[str] = []
            media_paths: list[str] = []

            try:
                content_json = json.loads(message.content) if message.content else {}
            except json.JSONDecodeError:
                content_json = {}

            if msg_type == "text":
                text = content_json.get("text", "")
                if text:
                    content_parts.append(text)

            elif msg_type == "post":
                text, image_keys = _extract_post_content(content_json)
                if text:
                    content_parts.append(text)
                for img_key in image_keys:
                    file_path, content_text = await self._download_and_save_media(
                        "image", {"image_key": img_key}, message_id
                    )
                    if file_path:
                        media_paths.append(file_path)
                    content_parts.append(content_text)

            elif msg_type in ("image", "audio", "file", "media"):
                file_path, content_text = await self._download_and_save_media(msg_type, content_json, message_id)
                if file_path:
                    media_paths.append(file_path)
                content_parts.append(content_text)

            elif msg_type in ("share_chat", "share_user", "interactive", "share_calendar_event", "system", "merge_forward"):
                text = _extract_share_card_content(content_json, msg_type)
                if text:
                    content_parts.append(text)

            else:
                content_parts.append(MSG_TYPE_MAP.get(msg_type, f"[{msg_type}]"))

            content = "\n".join(content_parts) if content_parts else ""
            if not content and not media_paths:
                return

            # Group message reply to group, private chat reply to open_id
            reply_to = chat_id if chat_type == "group" else sender_id
            session_id = f"{self.name}@{reply_to}"

            await get_inbound_queue().put(InboundMessage(
                session_id=session_id,
                content=content,
                metadata={
                    "sender_id": sender_id,
                    "message_id": message_id,
                    "chat_type": chat_type,
                    "msg_type": msg_type,
                    "media": media_paths,
                },
            ))

        except Exception as e:
            logger.error("[{}] Process message error: {}", self.name, e)

    # ── Emoji reaction ───────────────────────────────────────────────────────

    async def _add_reaction(self, message_id: str, emoji_type: str = "THUMBSUP") -> None:
        if not self._client or not Emoji:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._add_reaction_sync, message_id, emoji_type)

    def _add_reaction_sync(self, message_id: str, emoji_type: str) -> None:
        try:
            request = (
                CreateMessageReactionRequest.builder()
                .message_id(message_id)
                .request_body(
                    CreateMessageReactionRequestBody.builder()
                    .reaction_type(Emoji.builder().emoji_type(emoji_type).build())
                    .build()
                )
                .build()
            )
            response = self._client.im.v1.message_reaction.create(request)
            if not response.success():
                logger.warning("[{}] Add reaction failed: code={}", self.name, response.code)
        except Exception as e:
            logger.warning("[{}] Add reaction error: {}", self.name, e)

    # ── Media download ───────────────────────────────────────────────────────

    async def _download_and_save_media(
        self, msg_type: str, content_json: dict, message_id: str | None = None
    ) -> tuple[str | None, str]:
        loop = asyncio.get_running_loop()
        media_dir = Path.home() / ".aurogen" / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        data, filename = None, None

        if msg_type == "image":
            image_key = content_json.get("image_key")
            if image_key and message_id:
                data, filename = await loop.run_in_executor(
                    None, self._download_image_sync, message_id, image_key
                )
                if not filename:
                    filename = f"{image_key[:16]}.jpg"

        elif msg_type in ("audio", "file", "media"):
            file_key = content_json.get("file_key")
            if file_key and message_id:
                data, filename = await loop.run_in_executor(
                    None, self._download_file_sync, message_id, file_key, msg_type
                )
                if not filename:
                    ext = {"audio": ".opus", "media": ".mp4"}.get(msg_type, "")
                    filename = f"{file_key[:16]}{ext}"

        if data and filename:
            file_path = media_dir / filename
            file_path.write_bytes(data)
            return str(file_path), f"[{msg_type}: {filename}]"

        return None, f"[{msg_type}: download failed]"

    def _download_image_sync(self, message_id: str, image_key: str) -> tuple[bytes | None, str | None]:
        try:
            request = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(image_key)
                .type("image")
                .build()
            )
            response = self._client.im.v1.message_resource.get(request)
            if response.success():
                file_data = response.file
                if hasattr(file_data, "read"):
                    file_data = file_data.read()
                return file_data, response.file_name
            return None, None
        except Exception as e:
            logger.error("[{}] Download image failed: {}", self.name, e)
            return None, None

    def _download_file_sync(self, message_id: str, file_key: str, resource_type: str = "file") -> tuple[bytes | None, str | None]:
        try:
            request = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(file_key)
                .type(resource_type)
                .build()
            )
            response = self._client.im.v1.message_resource.get(request)
            if response.success():
                file_data = response.file
                if hasattr(file_data, "read"):
                    file_data = file_data.read()
                return file_data, response.file_name
            return None, None
        except Exception:
            logger.exception("[{}] Download file failed: {}", self.name, file_key)
            return None, None

    # ── Markdown → Feishu card rendering ──────────────────────────────────────

    @staticmethod
    def _parse_md_table(table_text: str) -> dict | None:
        lines = [ln.strip() for ln in table_text.strip().split("\n") if ln.strip()]
        if len(lines) < 3:
            return None
        def split(ln: str) -> list[str]:
            return [c.strip() for c in ln.strip("|").split("|")]
        headers = split(lines[0])
        rows = [split(ln) for ln in lines[2:]]
        columns = [{"tag": "column", "name": f"c{i}", "display_name": h, "width": "auto"}
                   for i, h in enumerate(headers)]
        return {
            "tag": "table",
            "page_size": len(rows) + 1,
            "columns": columns,
            "rows": [{f"c{i}": r[i] if i < len(r) else "" for i in range(len(headers))} for r in rows],
        }

    def _build_card_elements(self, content: str) -> list[dict]:
        elements, last_end = [], 0
        for m in self._TABLE_RE.finditer(content):
            before = content[last_end:m.start()]
            if before.strip():
                elements.extend(self._split_headings(before))
            elements.append(self._parse_md_table(m.group(1)) or {"tag": "markdown", "content": m.group(1)})
            last_end = m.end()
        remaining = content[last_end:]
        if remaining.strip():
            elements.extend(self._split_headings(remaining))
        return elements or [{"tag": "markdown", "content": content}]

    def _split_headings(self, content: str) -> list[dict]:
        protected = content
        code_blocks: list[str] = []
        for m in self._CODE_BLOCK_RE.finditer(content):
            code_blocks.append(m.group(1))
            protected = protected.replace(m.group(1), f"\x00CODE{len(code_blocks)-1}\x00", 1)

        elements: list[dict] = []
        last_end = 0
        for m in self._HEADING_RE.finditer(protected):
            before = protected[last_end:m.start()].strip()
            if before:
                elements.append({"tag": "markdown", "content": before})
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": f"**{m.group(2).strip()}**"},
            })
            last_end = m.end()
        remaining = protected[last_end:].strip()
        if remaining:
            elements.append({"tag": "markdown", "content": remaining})

        for i, cb in enumerate(code_blocks):
            for el in elements:
                if el.get("tag") == "markdown":
                    el["content"] = el["content"].replace(f"\x00CODE{i}\x00", cb)

        return elements or [{"tag": "markdown", "content": content}]
