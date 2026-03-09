"""事件广播器。"""

import asyncio
from typing import Optional

from config.config import config_manager
from message.events import AgentEvent


class EventBroadcaster:
    """
    极简事件广播器。
    
    管理每个 session 的事件队列，实现按 session_id 分发事件。
    """

    def __init__(self):
        self._sessions: dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        """注册 session，返回该 session 的事件队列。"""
        async with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = asyncio.Queue()
            return self._sessions[session_id]

    async def unsubscribe(self, session_id: str) -> None:
        """注销 session。"""
        async with self._lock:
            self._sessions.pop(session_id, None)

    async def publish(self, event: AgentEvent) -> None:
        """发布事件到对应 session 的队列。"""
        async with self._lock:
            queue = self._sessions.get(event.session_id)
        
        if queue:
            await queue.put(event)


# 全局单例
_broadcaster: Optional[EventBroadcaster] = None


def get_broadcaster() -> EventBroadcaster:
    """获取全局 EventBroadcaster 实例。"""
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = EventBroadcaster()
    return _broadcaster
