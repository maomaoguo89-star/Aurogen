"""Email channel implementation using IMAP polling + SMTP replies."""

import asyncio
import html
import imaplib
import re
import smtplib
import ssl
from datetime import date
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr
from typing import Any

from loguru import logger

from channels.base import BaseChannel
from message.events import InboundMessage
from message.queue_manager import get_inbound_queue


class EmailChannel(BaseChannel):
    """Email channel using IMAP polling for inbound and SMTP for outbound.

    settings:
        imap_host            : IMAP 服务器地址
        imap_port            : IMAP 端口 (default: 993)
        imap_username        : IMAP 登录用户名
        imap_password        : IMAP 登录密码
        imap_use_ssl         : 是否使用 SSL (default: true)
        imap_mailbox         : 轮询的邮箱文件夹 (default: "INBOX")
        smtp_host            : SMTP 服务器地址
        smtp_port            : SMTP 端口 (default: 465)
        smtp_username        : SMTP 登录用户名
        smtp_password        : SMTP 登录密码
        smtp_use_ssl         : 是否使用 SMTP SSL (default: true)
        smtp_use_tls         : 是否使用 STARTTLS (default: false)
        from_address         : 发件人地址 (default: smtp_username)
        consent_granted      : 安全开关，必须显式设为 true (default: false)
        auto_reply_enabled   : 是否自动回复 (default: true)
        mark_seen            : 轮询后标记已读 (default: true)
        poll_interval_seconds: 轮询间隔秒数 (default: 30)
        max_body_chars       : 邮件正文最大字符数 (default: 10000)
        subject_prefix       : 回复邮件主题前缀 (default: "Re: ")
    """

    _IMAP_MONTHS = (
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    )

    def __init__(self, channel_key: str, settings: dict):
        self.name = channel_key

        # IMAP
        self._imap_host: str = settings.get("imap_host", "")
        self._imap_port: int = int(settings.get("imap_port", 993))
        self._imap_username: str = settings.get("imap_username", "")
        self._imap_password: str = settings.get("imap_password", "")
        self._imap_use_ssl: bool = bool(settings.get("imap_use_ssl", True))
        self._imap_mailbox: str = settings.get("imap_mailbox", "INBOX")

        # SMTP
        self._smtp_host: str = settings.get("smtp_host", "")
        self._smtp_port: int = int(settings.get("smtp_port", 465))
        self._smtp_username: str = settings.get("smtp_username", "")
        self._smtp_password: str = settings.get("smtp_password", "")
        self._smtp_use_ssl: bool = bool(settings.get("smtp_use_ssl", True))
        self._smtp_use_tls: bool = bool(settings.get("smtp_use_tls", False))

        # Misc
        self._from_address: str = settings.get("from_address", "")
        self._consent_granted: bool = bool(settings.get("consent_granted", False))
        self._auto_reply_enabled: bool = bool(settings.get("auto_reply_enabled", True))
        self._mark_seen: bool = bool(settings.get("mark_seen", True))
        self._poll_interval_seconds: int = int(settings.get("poll_interval_seconds", 30))
        self._max_body_chars: int = int(settings.get("max_body_chars", 10000))
        self._subject_prefix: str = settings.get("subject_prefix", "Re: ")

        # State
        self._last_subject_by_chat: dict[str, str] = {}
        self._last_message_id_by_chat: dict[str, str] = {}
        self._processed_uids: set[str] = set()
        self._MAX_PROCESSED_UIDS = 100000
        self._poll_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if not self._consent_granted:
            logger.warning(
                "[{}] Email channel 已禁用: consent_granted 为 false，"
                "请在用户明确授权后设为 true",
                self.name,
            )
            return

        if not self._validate_config():
            return

        self._running = True
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info("[{}] Email channel 已启动（IMAP 轮询模式）", self.name)

    async def _poll_loop(self) -> None:
        poll_seconds = max(5, self._poll_interval_seconds)
        while self._running:
            try:
                inbound_items = await asyncio.to_thread(self._fetch_new_messages)
                for item in inbound_items:
                    sender = item["sender"]
                    subject = item.get("subject", "")
                    message_id = item.get("message_id", "")

                    if subject:
                        self._last_subject_by_chat[sender] = subject
                    if message_id:
                        self._last_message_id_by_chat[sender] = message_id

                    session_id = f"{self.name}@{sender}"
                    await get_inbound_queue().put(InboundMessage(
                        session_id=session_id,
                        content=item["content"],
                        metadata=item.get("metadata", {}),
                    ))
            except Exception as e:
                logger.error("[{}] Email 轮询异常: {}", self.name, e)

            await asyncio.sleep(poll_seconds)

    async def stop(self) -> None:
        self._running = False
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        logger.info("[{}] Email channel 已停止", self.name)

    # ── 出站：发送邮件 ────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str) -> None:
        if not self._consent_granted:
            logger.warning("[{}] 跳过发送: consent_granted 为 false", self.name)
            return

        if not self._auto_reply_enabled:
            logger.info("[{}] 跳过自动回复: auto_reply_enabled 为 false", self.name)
            return

        if not self._smtp_host:
            logger.warning("[{}] SMTP host 未配置", self.name)
            return

        to_addr = chat_id.strip()
        if not to_addr:
            logger.warning("[{}] 缺少收件人地址", self.name)
            return
        if not content or not content.strip():
            return

        base_subject = self._last_subject_by_chat.get(to_addr, "reply")
        subject = self._reply_subject(base_subject)

        email_msg = EmailMessage()
        email_msg["From"] = self._from_address or self._smtp_username or self._imap_username
        email_msg["To"] = to_addr
        email_msg["Subject"] = subject
        email_msg.set_content(content)

        in_reply_to = self._last_message_id_by_chat.get(to_addr)
        if in_reply_to:
            email_msg["In-Reply-To"] = in_reply_to
            email_msg["References"] = in_reply_to

        try:
            await asyncio.to_thread(self._smtp_send, email_msg)
        except Exception as e:
            logger.error("[{}] 发送邮件到 {} 失败: {}", self.name, to_addr, e)

    # ── 配置校验 ──────────────────────────────────────────────────────────────

    def _validate_config(self) -> bool:
        missing = []
        if not self._imap_host:
            missing.append("imap_host")
        if not self._imap_username:
            missing.append("imap_username")
        if not self._imap_password:
            missing.append("imap_password")
        if not self._smtp_host:
            missing.append("smtp_host")
        if not self._smtp_username:
            missing.append("smtp_username")
        if not self._smtp_password:
            missing.append("smtp_password")

        if missing:
            logger.error("[{}] Email channel 配置缺失: {}", self.name, ", ".join(missing))
            return False
        return True

    # ── SMTP 发送 ─────────────────────────────────────────────────────────────

    def _smtp_send(self, msg: EmailMessage) -> None:
        timeout = 30
        if self._smtp_use_ssl:
            with smtplib.SMTP_SSL(self._smtp_host, self._smtp_port, timeout=timeout) as smtp:
                smtp.login(self._smtp_username, self._smtp_password)
                smtp.send_message(msg)
            return

        with smtplib.SMTP(self._smtp_host, self._smtp_port, timeout=timeout) as smtp:
            if self._smtp_use_tls:
                smtp.starttls(context=ssl.create_default_context())
            smtp.login(self._smtp_username, self._smtp_password)
            smtp.send_message(msg)

    # ── IMAP 收取 ─────────────────────────────────────────────────────────────

    def _fetch_new_messages(self) -> list[dict[str, Any]]:
        return self._fetch_messages(
            search_criteria=("UNSEEN",),
            mark_seen=self._mark_seen,
            dedupe=True,
            limit=0,
        )

    def fetch_messages_between_dates(
        self,
        start_date: date,
        end_date: date,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Fetch messages in [start_date, end_date) by IMAP date search."""
        if end_date <= start_date:
            return []
        return self._fetch_messages(
            search_criteria=(
                "SINCE",
                self._format_imap_date(start_date),
                "BEFORE",
                self._format_imap_date(end_date),
            ),
            mark_seen=False,
            dedupe=False,
            limit=max(1, int(limit)),
        )

    def _fetch_messages(
        self,
        search_criteria: tuple[str, ...],
        mark_seen: bool,
        dedupe: bool,
        limit: int,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        mailbox = self._imap_mailbox or "INBOX"

        if self._imap_use_ssl:
            client = imaplib.IMAP4_SSL(self._imap_host, self._imap_port)
        else:
            client = imaplib.IMAP4(self._imap_host, self._imap_port)

        try:
            client.login(self._imap_username, self._imap_password)
            status, _ = client.select(mailbox)
            if status != "OK":
                return messages

            status, data = client.search(None, *search_criteria)
            if status != "OK" or not data:
                return messages

            ids = data[0].split()
            if limit > 0 and len(ids) > limit:
                ids = ids[-limit:]
            for imap_id in ids:
                status, fetched = client.fetch(imap_id, "(BODY.PEEK[] UID)")
                if status != "OK" or not fetched:
                    continue

                raw_bytes = self._extract_message_bytes(fetched)
                if raw_bytes is None:
                    continue

                uid = self._extract_uid(fetched)
                if dedupe and uid and uid in self._processed_uids:
                    continue

                parsed = BytesParser(policy=policy.default).parsebytes(raw_bytes)
                sender = parseaddr(parsed.get("From", ""))[1].strip().lower()
                if not sender:
                    continue

                subject = self._decode_header_value(parsed.get("Subject", ""))
                date_value = parsed.get("Date", "")
                message_id = parsed.get("Message-ID", "").strip()
                body = self._extract_text_body(parsed)

                if not body:
                    body = "(empty email body)"

                body = body[: self._max_body_chars]
                content = (
                    f"Email received.\n"
                    f"From: {sender}\n"
                    f"Subject: {subject}\n"
                    f"Date: {date_value}\n\n"
                    f"{body}"
                )

                metadata = {
                    "message_id": message_id,
                    "subject": subject,
                    "date": date_value,
                    "sender_email": sender,
                    "uid": uid,
                }
                messages.append(
                    {
                        "sender": sender,
                        "subject": subject,
                        "message_id": message_id,
                        "content": content,
                        "metadata": metadata,
                    }
                )

                if dedupe and uid:
                    self._processed_uids.add(uid)
                    if len(self._processed_uids) > self._MAX_PROCESSED_UIDS:
                        self._processed_uids.clear()

                if mark_seen:
                    client.store(imap_id, "+FLAGS", "\\Seen")
        finally:
            try:
                client.logout()
            except Exception:
                pass

        return messages

    # ── 工具方法 ──────────────────────────────────────────────────────────────

    @classmethod
    def _format_imap_date(cls, value: date) -> str:
        month = cls._IMAP_MONTHS[value.month - 1]
        return f"{value.day:02d}-{month}-{value.year}"

    @staticmethod
    def _extract_message_bytes(fetched: list[Any]) -> bytes | None:
        for item in fetched:
            if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
                return bytes(item[1])
        return None

    @staticmethod
    def _extract_uid(fetched: list[Any]) -> str:
        for item in fetched:
            if isinstance(item, tuple) and item and isinstance(item[0], (bytes, bytearray)):
                head = bytes(item[0]).decode("utf-8", errors="ignore")
                m = re.search(r"UID\s+(\d+)", head)
                if m:
                    return m.group(1)
        return ""

    @staticmethod
    def _decode_header_value(value: str) -> str:
        if not value:
            return ""
        try:
            return str(make_header(decode_header(value)))
        except Exception:
            return value

    @classmethod
    def _extract_text_body(cls, msg: Any) -> str:
        if msg.is_multipart():
            plain_parts: list[str] = []
            html_parts: list[str] = []
            for part in msg.walk():
                if part.get_content_disposition() == "attachment":
                    continue
                content_type = part.get_content_type()
                try:
                    payload = part.get_content()
                except Exception:
                    payload_bytes = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    payload = payload_bytes.decode(charset, errors="replace")
                if not isinstance(payload, str):
                    continue
                if content_type == "text/plain":
                    plain_parts.append(payload)
                elif content_type == "text/html":
                    html_parts.append(payload)
            if plain_parts:
                return "\n\n".join(plain_parts).strip()
            if html_parts:
                return cls._html_to_text("\n\n".join(html_parts)).strip()
            return ""

        try:
            payload = msg.get_content()
        except Exception:
            payload_bytes = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            payload = payload_bytes.decode(charset, errors="replace")
        if not isinstance(payload, str):
            return ""
        if msg.get_content_type() == "text/html":
            return cls._html_to_text(payload).strip()
        return payload.strip()

    @staticmethod
    def _html_to_text(raw_html: str) -> str:
        text = re.sub(r"<\s*br\s*/?>", "\n", raw_html, flags=re.IGNORECASE)
        text = re.sub(r"<\s*/\s*p\s*>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", text)
        return html.unescape(text)

    def _reply_subject(self, base_subject: str) -> str:
        subject = (base_subject or "").strip() or "reply"
        prefix = self._subject_prefix or "Re: "
        if subject.lower().startswith("re:"):
            return subject
        return f"{prefix}{subject}"
