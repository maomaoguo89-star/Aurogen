"""消息数据结构。"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class EventType(Enum):
    """Agent 事件类型。"""
    THINKING = "thinking"        # LLM 思考过程（thinking/reasoning）
    TOOL_CALL = "tool_call"      # 工具开始调用
    TOOL_RESULT = "tool_result"  # 工具执行结果
    FINAL = "final"              # 最终回复


@dataclass
class InboundMessage:
    """入站消息。"""
    session_id: str
    # agent_name: str
    content: str
    metadata: dict = field(default_factory=dict)


@dataclass
class OutboundMessage:
    """出站消息。"""
    session_id: str
    channel: str       # channel 标识符，如 "web" / "qq" / "feishu"
    chat_id: str       # 目标会话 ID（session_id 中 "_" 后的部分）
    content: str
    metadata: dict = field(default_factory=dict)


@dataclass
class AgentEvent:
    """Agent 事件，用于 SSE 推送。"""
    session_id: str
    # agent_name: str
    event_type: EventType
    data: dict = field(default_factory=dict)

    def to_sse(self) -> str:
        """转换为 SSE 格式字符串。"""
        import json
        return f"event: {self.event_type.value}\ndata: {json.dumps(self.data, ensure_ascii=False)}\n\n"
