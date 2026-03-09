"""WebChannel：通过 HTTP/SSE 收发消息的 channel 实现。"""

import asyncio
from typing import AsyncGenerator

from channels.base import BaseChannel
from message.broadcaster import get_broadcaster
from message.events import AgentEvent, EventType, InboundMessage
from message.queue_manager import get_inbound_queue


class WebChannel(BaseChannel):
    """
    Web channel，对应 session_id 前缀 "web"。

    入站：HTTP POST 请求 → receive() → inbound_queue
    出站：send() → broadcaster.publish() → SSE 流推送给客户端

    SSE 进度事件（TOOL_CALL / TOOL_RESULT）由 AgentLoop 直接调用
    broadcaster，无需经过 ChannelManager 路由，WebChannel 不干预。
    """

    name = "web"

    def __init__(self, channel_key: str = "web", settings: dict | None = None):
        self.name = channel_key

    async def receive(self, session_id: str, content: str, metadata: dict | None = None) -> None:
        """将入站消息投入 inbound_queue。"""
        msg = InboundMessage(
            session_id=session_id,
            content=content,
            metadata=metadata or {},
        )
        await get_inbound_queue().put(msg)

    async def send(self, chat_id: str, content: str) -> None:
        """将最终回复推送到对应 session 的 SSE 队列。"""
        session_id = f"{self.name}@{chat_id}"
        await get_broadcaster().publish(AgentEvent(
            session_id=session_id,
            event_type=EventType.FINAL,
            data={"content": content},
        ))

    async def notify(self, event: AgentEvent) -> None:
        """将中间事件（THINKING/TOOL_CALL/TOOL_RESULT）推送到对应 session 的 SSE 队列。"""
        await get_broadcaster().publish(event)

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        """注册 SSE 订阅，返回该 session 的事件队列。"""
        return await get_broadcaster().subscribe(session_id)

    async def unsubscribe(self, session_id: str) -> None:
        """注销 SSE 订阅。"""
        await get_broadcaster().unsubscribe(session_id)

    def event_stream(self, queue: asyncio.Queue) -> AsyncGenerator[str, None]:
        """
        返回一个异步生成器，消费队列中的事件并生成 SSE 格式字符串。
        收到 FINAL 事件后自动结束。
        """
        async def _gen():
            while True:
                event: AgentEvent = await queue.get()
                yield event.to_sse()
                if event.event_type == EventType.FINAL:
                    break

        return _gen()
