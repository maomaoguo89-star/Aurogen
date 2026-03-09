"""ChannelManager：全局单例，负责 channel 注册、从 config 加载与动态重载。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from loguru import logger

from channels.base import BaseChannel

if TYPE_CHECKING:
    from message.events import AgentEvent


@dataclass
class ChannelTypeInfo:
    """channel 类型的元信息，供 ChannelManager 和 API 使用。"""
    cls: type[BaseChannel]
    description: str = ""
    required_settings: list[str] = field(default_factory=list)
    builtin: bool = False   # True 表示内置 channel，不暴露给 supported/add/delete API


def _build_registry() -> dict[str, ChannelTypeInfo]:
    """延迟导入，避免循环依赖。"""
    from channels.web import WebChannel
    from channels.feishu import FeishuChannel
    from channels.qq import QQChannel
    from channels.dingtalk import DingTalkChannel
    from channels.discord import DiscordChannel
    from channels.email import EmailChannel
    from channels.mochat import MochatChannel
    from channels.slack import SlackChannel
    from channels.telegram import TelegramChannel
    from channels.whatsapp import WhatsAppChannel
    return {
        "web": ChannelTypeInfo(
            cls=WebChannel,
            description="Web SSE channel",
            builtin=True,
        ),
        "feishu": ChannelTypeInfo(
            cls=FeishuChannel,
            description="飞书 WebSocket channel",
            required_settings=["app_id", "app_secret"],
        ),
        "qq": ChannelTypeInfo(
            cls=QQChannel,
            description="QQ 私聊 channel (botpy)",
            required_settings=["app_id", "secret"],
        ),
        "dingtalk": ChannelTypeInfo(
            cls=DingTalkChannel,
            description="钉钉 Stream channel",
            required_settings=["client_id", "client_secret"],
        ),
        "discord": ChannelTypeInfo(
            cls=DiscordChannel,
            description="Discord Gateway channel",
            required_settings=["token"],
        ),
        "email": ChannelTypeInfo(
            cls=EmailChannel,
            description="Email IMAP/SMTP channel",
            required_settings=["imap_host", "imap_username", "imap_password",
                               "smtp_host", "smtp_username", "smtp_password"],
        ),
        "mochat": ChannelTypeInfo(
            cls=MochatChannel,
            description="Mochat Socket.IO channel",
            required_settings=["claw_token", "base_url"],
        ),
        "slack": ChannelTypeInfo(
            cls=SlackChannel,
            description="Slack Socket Mode channel",
            required_settings=["bot_token", "app_token"],
        ),
        "telegram": ChannelTypeInfo(
            cls=TelegramChannel,
            description="Telegram Bot channel (polling)",
            required_settings=["token"],
        ),
        "whatsapp": ChannelTypeInfo(
            cls=WhatsAppChannel,
            description="WhatsApp channel (Baileys bridge)",
            required_settings=["bridge_port"],
        ),
    }


class ChannelManager:
    """
    管理所有已注册的 channel。

    职责：
    - 出站消息路由：send(channel_name, chat_id, content)
    - 从 config 批量实例化 channel：load_from_config()
    - 运行时增量重载：reload()
    - 状态查询：status()
    """

    def __init__(self):
        self._channels: dict[str, BaseChannel] = {}
        # 记录每个 channel 对应的 asyncio Task（用于有后台循环的 channel）
        self._tasks: dict[str, asyncio.Task] = {}

    # ── 基本操作 ──────────────────────────────────────────────────────────────

    def register(self, channel: BaseChannel) -> None:
        """手动注册一个已实例化的 channel（无需 start）。"""
        self._channels[channel.name] = channel

    def get(self, channel_name: str) -> Optional[BaseChannel]:
        """获取指定 channel 实例，不存在返回 None。"""
        return self._channels.get(channel_name)

    async def send(self, channel_name: str, chat_id: str, content: str) -> None:
        """将消息路由到对应 channel 的 send() 方法。"""
        channel = self._channels.get(channel_name)
        if channel is None:
            logger.warning("[ChannelManager] 未知 channel: {}，消息丢弃", channel_name)
            return
        await channel.send(chat_id, content)

    async def notify(self, channel_name: str, event: "AgentEvent") -> None:
        """路由中间事件（THINKING/TOOL_CALL/TOOL_RESULT）到对应 channel 的 notify() 方法。"""
        channel = self._channels.get(channel_name)
        if channel:
            await channel.notify(event)

    # ── 从 config 加载 ────────────────────────────────────────────────────────

    async def load_from_config(self) -> None:
        """
        启动时读取全部 channel config，实例化并 start()。
        等价于对每个 config 条目调用 _start_channel()。
        """
        from config.config import config_manager
        registry = _build_registry()

        channels_cfg: dict = config_manager.get("channels", {})
        for key, cfg in channels_cfg.items():
            channel_type = cfg.get("type", key)
            info = registry.get(channel_type)
            if info is None:
                logger.warning("[ChannelManager] 未知 channel 类型: {}，跳过", channel_type)
                continue
            await self._start_channel(key, info, cfg)

    async def _start_channel(self, key: str, info: ChannelTypeInfo, cfg: dict) -> None:
        """实例化并 start() 一个 channel。"""
        settings = cfg.get("settings", {})
        try:
            channel = info.cls(channel_key=key, settings=settings)
            self._channels[key] = channel
            await channel.start()
            logger.info("[ChannelManager] channel '{}' 已启动", key)
        except Exception as e:
            logger.error("[ChannelManager] 启动 channel '{}' 失败: {}", key, e)

    # ── 动态重载 ──────────────────────────────────────────────────────────────

    async def reload(self) -> dict:
        """
        对比当前运行的 channel 与最新 config，增量更新：
        - 新增的 channel → start()
        - 移除的 channel → stop()
        - 已存在的 channel → 保持不变（避免断连）

        返回变更摘要 dict。
        """
        from config.config import config_manager
        registry = _build_registry()

        channels_cfg: dict = config_manager.get("channels", {})
        config_keys = set(channels_cfg.keys())
        running_keys = set(self._channels.keys())

        added = config_keys - running_keys
        removed = running_keys - config_keys
        unchanged = running_keys & config_keys

        for key in removed:
            await self._stop_channel(key)

        for key in added:
            cfg = channels_cfg[key]
            channel_type = cfg.get("type", key)
            info = registry.get(channel_type)
            if info is None:
                logger.warning("[ChannelManager] 未知 channel 类型: {}，跳过", channel_type)
                continue
            await self._start_channel(key, info, cfg)

        return {
            "added": list(added),
            "removed": list(removed),
            "unchanged": list(unchanged),
        }

    async def _stop_channel(self, key: str) -> None:
        """停止并注销一个 channel。"""
        channel = self._channels.pop(key, None)
        if channel:
            try:
                await channel.stop()
                logger.info("[ChannelManager] channel '{}' 已停止", key)
            except Exception as e:
                logger.error("[ChannelManager] 停止 channel '{}' 失败: {}", key, e)

    async def stop_all(self) -> None:
        """停止所有已注册的 channel（应用关闭时调用）。"""
        for key in list(self._channels.keys()):
            await self._stop_channel(key)

    # ── 状态查询 ──────────────────────────────────────────────────────────────

    def status(self) -> dict:
        """返回当前已注册 channel 列表及其状态。"""
        return {
            "channels": [
                {
                    "name": name,
                    "type": type(ch).__name__,
                    "running": getattr(ch, "_running", True),
                }
                for name, ch in self._channels.items()
            ]
        }


# ── 全局单例 ─────────────────────────────────────────────────────────────────

_channel_manager: Optional[ChannelManager] = None


def get_channel_manager() -> ChannelManager:
    """获取全局 ChannelManager 实例。"""
    global _channel_manager
    if _channel_manager is None:
        _channel_manager = ChannelManager()
    return _channel_manager
