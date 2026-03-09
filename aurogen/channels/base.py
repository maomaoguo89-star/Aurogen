"""BaseChannel 抽象类，所有 channel 实现的统一接口。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from message.events import AgentEvent


class BaseChannel(ABC):
    """
    Channel 基类。

    每个 channel 对应一种通信方式（web SSE、QQ、飞书等）。
    入站：channel 负责接收外部消息并投入 inbound_queue。
    出站：AgentLoop 处理完毕后通过 ChannelManager 路由到对应 channel 的 send()。
    """

    name: str  # channel 标识符，与 session_id 前缀一致，如 "web" / "qq" / "feishu"

    async def start(self) -> None:
        """启动 channel（建立连接、注册事件监听等）。"""

    async def stop(self) -> None:
        """停止 channel。"""

    @abstractmethod
    async def send(self, chat_id: str, content: str) -> None:
        """向指定 chat_id 发送最终回复消息。"""

    async def notify(self, event: "AgentEvent") -> None:
        """推送中间事件（THINKING/TOOL_CALL/TOOL_RESULT）。默认不处理。"""
