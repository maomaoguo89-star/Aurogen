"""WebChannel: channel implementation for sending/receiving messages via HTTP/SSE."""

import asyncio
from typing import AsyncGenerator

from channels.base import BaseChannel
from message.broadcaster import get_broadcaster
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue


class WebChannel(BaseChannel):
    """
    Web channel; session_id prefix is "web".

    Inbound: HTTP POST request → receive() → inbound_queue
    Outbound: send() → broadcaster.publish() → SSE stream pushed to client

    SSE progress events (TOOL_CALL / TOOL_RESULT) are published by AgentLoop
    directly via broadcaster; no ChannelManager routing; WebChannel does not intervene.
    """

    name = "web"

    def __init__(self, channel_key: str = "web", settings: dict | None = None):
        self.name = channel_key

    async def receive(self, session_id: str, content: str, metadata: dict | None = None) -> None:
        """Put inbound message into inbound_queue."""
        msg = InboundMessage(
            session_id=session_id,
            content=content,
            metadata=metadata or {},
        )
        await get_inbound_queue().put(msg)

    async def send(self, chat_id: str, content: str) -> None:
        """Push final reply to the SSE queue for the given session."""
        session_id = f"{self.name}@{chat_id}"
        await get_broadcaster().publish(AgentEvent(
            session_id=session_id,
            event_type=EventType.FINAL,
            data={"content": content},
        ))

    async def notify(self, event: AgentEvent) -> None:
        """Push intermediate events (THINKING/TOOL_CALL/TOOL_RESULT) to the SSE queue for the given session."""
        await get_broadcaster().publish(event)

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        """Register SSE subscription; return the event queue for this session."""
        return await get_broadcaster().subscribe(session_id)

    async def unsubscribe(self, session_id: str) -> None:
        """Unregister SSE subscription."""
        await get_broadcaster().unsubscribe(session_id)

    def event_stream(self, queue: asyncio.Queue) -> AsyncGenerator[str, None]:
        """
        Return an async generator that consumes events from the queue and yields SSE-formatted strings.
        Stops automatically after receiving a FINAL event.
        """
        async def _gen():
            while True:
                event: AgentEvent = await queue.get()
                yield event.to_sse()
                if event.event_type == EventType.FINAL:
                    break

        return _gen()
