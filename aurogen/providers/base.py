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
    usage: dict[str, Any] | None = None   # 原始 usage/cached_tokens 统计（若上游返回）

    def prompt_tokens(self) -> int | None:
        if not self.usage:
            return None
        value = self.usage.get("prompt_tokens")
        return value if isinstance(value, int) else None

    def cached_tokens(self) -> int | None:
        if not self.usage:
            return None
        details = self.usage.get("prompt_tokens_details")
        if not isinstance(details, dict):
            return None
        value = details.get("cached_tokens")
        return value if isinstance(value, int) else None

    def cache_summary(self) -> str | None:
        if not self.usage:
            return None
        prompt_tokens = self.prompt_tokens()
        completion_tokens = self.usage.get("completion_tokens")
        total_tokens = self.usage.get("total_tokens")
        cached_tokens = self.cached_tokens()
        parts: list[str] = []
        if isinstance(prompt_tokens, int):
            parts.append(f"prompt_tokens={prompt_tokens}")
        if isinstance(cached_tokens, int):
            parts.append(f"cached_tokens={cached_tokens}")
            if prompt_tokens and prompt_tokens > 0:
                parts.append(f"cache_hit={cached_tokens / prompt_tokens:.1%}")
        if isinstance(completion_tokens, int):
            parts.append(f"completion_tokens={completion_tokens}")
        if isinstance(total_tokens, int):
            parts.append(f"total_tokens={total_tokens}")
        return ", ".join(parts) if parts else None


class BaseProviderAdapter(ABC):
    @abstractmethod
    def response(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        thinking: str = "none",
    ) -> AdapterResponse:
        pass
