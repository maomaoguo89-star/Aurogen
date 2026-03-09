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
        return "Send a message to the user. Use this when you want to communicate something."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The message content to send",
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
