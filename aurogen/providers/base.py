from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AdapterResponse:
    """所有 Provider Adapter 的标准化返回格式。

    Adapter 内部负责将各自的原始 API 响应解析为此格式，
    core.py 只需消费标准字段，无需了解任何 provider 细节。
    """

    content: str                          # 最终文本回复（tool_calls 时可为空串）
    thinking: str | None = None           # thinking/reasoning 内容，不支持则为 None
    tool_calls: list[dict] | None = None  # 标准化 tool_calls，无则为 None
    reasoning_details: Any = None         # 多轮 thinking 透传字段（如 aihubmix reasoning_details）


class BaseProviderAdapter(ABC):
    @abstractmethod
    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: dict[str, Any] | str | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        pass
