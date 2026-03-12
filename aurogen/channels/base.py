"""BaseChannel abstract class: unified interface for all channel implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from message.events import AgentEvent


class BaseChannel(ABC):
    """
    Base class for channels.

    Each channel corresponds to one communication method (web SSE, QQ, Feishu, etc.).
    Inbound: channel receives external messages and enqueues them to inbound_queue.
    Outbound: after AgentLoop finishes, messages are routed via ChannelManager to the channel's send().
    """

    name: str  # channel identifier, matches session_id prefix, e.g. "web" / "qq" / "feishu"

    async def start(self) -> None:
        """Start the channel (establish connection, register event listeners, etc.)."""

    async def stop(self) -> None:
        """Stop the channel."""

    @abstractmethod
    async def send(self, chat_id: str, content: str) -> None:
        """Send the final reply message to the given chat_id."""

    async def notify(self, event: "AgentEvent") -> None:
        """Push intermediate events (THINKING/TOOL_CALL/TOOL_RESULT). No-op by default."""
