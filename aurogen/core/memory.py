"""Memory system for persistent agent memory."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING

from config.config import config_manager

if TYPE_CHECKING:
    from message.session_manager import Session
    from providers.providers import Provider


def ensure_dir(path: Path) -> Path:
    """Ensure directory exists, return it."""
    path.mkdir(parents=True, exist_ok=True)
    return path


_SAVE_MEMORY_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": "Save the memory consolidation result to persistent storage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "history_entry": {
                        "type": "string",
                        "description": "A paragraph (2-5 sentences) summarizing key events/decisions/topics. "
                        "Start with [YYYY-MM-DD HH:MM]. Include detail useful for grep search.",
                    },
                    "memory_update": {
                        "type": "string",
                        "description": "Full updated long-term memory as markdown. Include all existing "
                        "facts plus new ones. Return unchanged if nothing new.",
                    },
                },
                "required": ["history_entry", "memory_update"],
            },
        },
    }
]


class MemoryStore:
    """Two-layer memory: MEMORY.md (long-term facts) + HISTORY.md (grep-searchable log)."""

    def __init__(self, workspace: Path, agent_name: str = "main"):
        self.agent_name = agent_name
        self.memory_dir = ensure_dir(workspace / "agents" / agent_name / "memory")
        self.memory_file = self.memory_dir / "MEMORY.md"
        self.history_file = self.memory_dir / "HISTORY.md"

    def read_long_term(self) -> str:
        if self.memory_file.exists():
            return self.memory_file.read_text(encoding="utf-8")
        return ""

    def write_long_term(self, content: str) -> None:
        self.memory_file.write_text(content, encoding="utf-8")

    def append_history(self, entry: str) -> None:
        """追加历史记录到 HISTORY.md，文件不存在则自动创建。"""
        # 确保目录存在
        self.history_file.parent.mkdir(parents=True, exist_ok=True)
        # 写入文件（"a" 模式会在文件不存在时自动创建）
        with open(self.history_file, "a", encoding="utf-8") as f:
            f.write(entry.rstrip() + "\n\n")
            f.flush()  # 确保立即写入磁盘

    def get_memory_context(self) -> str:
        long_term = self.read_long_term()
        return f"## Long-term Memory\n{long_term}" if long_term else ""

    async def consolidate(
        self,
        session: Session,
        provider: Provider,
        *,
        archive_all: bool = False,
        memory_window: int = 100,
    ) -> bool:
        """Consolidate old messages into MEMORY.md + HISTORY.md via LLM tool call.

        Returns True on success (including no-op), False on failure.
        """
        if archive_all:
            old_messages = session.messages
            keep_count = 0
            print(f"[Memory] Consolidation (archive_all): {len(session.messages)} messages")
        else:
            keep_count = memory_window // 2
            if len(session.messages) <= keep_count:
                return True
            if len(session.messages) - session.last_consolidated <= memory_window:
                return True
            old_messages = session.messages[session.last_consolidated:-keep_count]
            if not old_messages:
                return True
            print(f"[Memory] Consolidation: {len(old_messages)} to consolidate, {keep_count} keep")

        lines = []
        for m in old_messages:
            if not m.get("content"):
                continue
            timestamp = m.get("timestamp", "?")[:16]
            role = m["role"].upper()
            content = m["content"]
            lines.append(f"[{timestamp}] {role}: {content}")

        current_memory = self.read_long_term()
        prompt = f"""Process this conversation and call the save_memory tool with your consolidation.

## Current Long-term Memory
{current_memory or "(empty)"}

## Conversation to Process
{chr(10).join(lines)}"""

        try:
            # 使用 Provider 的 response 方法
            response = await asyncio.to_thread(
                provider.response,
                messages=[
                    {"role": "system", "content": "You are a memory consolidation agent. Call the save_memory tool with your consolidation of the conversation."},
                    {"role": "user", "content": prompt},
                ],
                tools=_SAVE_MEMORY_TOOL,
                agent_name=self.agent_name,
            )

            print(f"[Memory] LLM response received")

            # 提取 tool_calls（AdapterResponse 已标准化）
            tool_calls = response.tool_calls
            if not tool_calls:
                print("[Memory] LLM did not call save_memory, skipping")
                print(f"[Memory] LLM response content: {response.content[:200] if response.content else 'None'}")
                return False

            print(f"[Memory] Tool calls: {[tc['function']['name'] for tc in tool_calls]}")

            args = tool_calls[0]["function"]["arguments"]
            print(f"[Memory] Raw arguments type: {type(args).__name__}")
            
            # arguments 可能是字符串或已经解析的 dict
            if isinstance(args, str):
                args = json.loads(args)
            if not isinstance(args, dict):
                print(f"[Memory] Unexpected arguments type: {type(args).__name__}")
                return False

            print(f"[Memory] Parsed args keys: {list(args.keys())}")

            entry = args.get("history_entry")
            if entry:
                if not isinstance(entry, str):
                    entry = json.dumps(entry, ensure_ascii=False)
                print(f"[Memory] Writing history entry: {entry[:100]}...")
                self.append_history(entry)
            else:
                print("[Memory] No history_entry in args")
                
            if update := args.get("memory_update"):
                if not isinstance(update, str):
                    update = json.dumps(update, ensure_ascii=False)
                if update != current_memory:
                    print(f"[Memory] Writing memory update: {update[:100]}...")
                    self.write_long_term(update)
                else:
                    print("[Memory] Memory unchanged, skipping write")
            else:
                print("[Memory] No memory_update in args")

            session.last_consolidated = 0 if archive_all else len(session.messages) - keep_count
            session._save_session()
            print(f"[Memory] Consolidation done: {len(session.messages)} messages, last_consolidated={session.last_consolidated}")
            return True
        except Exception as e:
            print(f"[Memory] Consolidation failed: {e}")
            return False

