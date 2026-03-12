"""Message tool for sending messages to users via ChannelManager."""

from typing import Any

from core.tools.base import Tool


class MessageTool(Tool):
    """Tool to send messages to users on chat channels."""

    def __init__(self) -> None:
        self._channel: str = ""
        self._chat_id: str = ""

    def set_context(self, channel: str, chat_id: str) -> None:
        """Set the current message context (called per inbound message)."""
        self._channel = channel
        self._chat_id = chat_id

    @property
    def name(self) -> str:
        return "message"

    @property
    def description(self) -> str:
        return (
            "Send an outbound message through the current channel without using the normal final reply. "
            "Only use this for proactive notifications during long-running work, sending to another user/channel, "
            "or when the user explicitly asks you to send a message. Do NOT use this for ordinary replies in the "
            "current conversation; answer normally instead."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": (
                        "Outbound message content to send via the channel manager. "
                        "Not for ordinary in-chat replies."
                    ),
                },
            },
            "required": ["content"],
        }

    async def execute(self, **kwargs: Any) -> str:
        content: str = kwargs["content"]
        channel = self._channel
        chat_id = self._chat_id

        if not channel or not chat_id:
            return "Error: No target channel/chat specified"

        from channels.manager import get_channel_manager

        try:
            await get_channel_manager().send(channel, chat_id, content)
            return f"Message sent to {channel}:{chat_id}"
        except Exception as e:
            return f"Error sending message: {e}"
