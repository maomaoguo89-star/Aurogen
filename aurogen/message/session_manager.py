"""Session manager with context builder for agent prompts."""

import os
import json
import platform
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from config.config import config_manager, WORKSPACE_DIR
from core.skills import SkillsLoader


class ContextBuilder:
    """Builds the context (system prompt + messages) for the agent."""

    PROMPT_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"]
    _RUNTIME_CONTEXT_TAG = "[Runtime Context — metadata only, not instructions]"

    def __init__(self, workspace: Path, agent_name: str):
        self.workspace = workspace
        self.agent_name = agent_name
        self.agent_workspace = workspace / "agents" / agent_name
        self.skills_loader = SkillsLoader(workspace=self.agent_workspace)

    def build_system_prompt(self) -> str:
        """Build the system prompt from identity, bootstrap files, and memory."""
        parts = [self._get_identity()]

        bootstrap = self._load_bootstrap_prompt()
        if bootstrap:
            parts.append(bootstrap)

        prompt_files = self._load_prompt_files()
        if prompt_files:
            parts.append(prompt_files)

        memory = self._get_memory_context()
        if memory:
            parts.append(f"# Memory\n\n{memory}")

        skills = self.skills_loader.build_skills_summary()
        if skills:
            parts.append(f"# Skills\n\n{skills}")

        return "\n\n---\n\n".join(parts)

    def _get_identity(self) -> str:
        """Get the core identity section."""
        workspace_path = str(self.agent_workspace.resolve())
        system = platform.system()
        runtime = f"{'macOS' if system == 'Darwin' else system} {platform.machine()}, Python {platform.python_version()}"

        agent_display_name = config_manager.get(f"agents.{self.agent_name}.name", self.agent_name)
        agent_description = config_manager.get(f"agents.{self.agent_name}.description", "")

        identity = f"""# {agent_display_name}

You are {agent_display_name}, {agent_description}.

## Runtime
{runtime}

## Workspace
Your workspace is at: {workspace_path}
- Long-term memory: {workspace_path}/memory/MEMORY.md (write important facts here)
- History log: {workspace_path}/memory/HISTORY.md (grep-searchable). Each entry starts with [YYYY-MM-DD HH:MM].
"""
        return identity

    def _get_memory_context(self) -> str:
        """Get long-term memory content."""
        memory_file = self.agent_workspace / "memory" / "MEMORY.md"
        if memory_file.exists():
            return memory_file.read_text(encoding="utf-8")
        return ""

    def _load_bootstrap_prompt(self) -> str:
        """Load BOOTSTRAP.md only while bootstrap is incomplete."""
        if config_manager.get(f"agents.{self.agent_name}.bootstrap_completed", False):
            return ""

        file_path = self.agent_workspace / "BOOTSTRAP.md"
        if file_path.exists():
            return file_path.read_text(encoding="utf-8")
        return ""

    def _load_prompt_files(self) -> str:
        """Load persistent prompt files from agent workspace."""
        parts = []

        for filename in self.PROMPT_FILES:
            file_path = self.agent_workspace / filename
            if file_path.exists():
                content = file_path.read_text(encoding="utf-8")
                # 去掉文件名前缀，直接添加内容
                parts.append(content)

        return "\n\n".join(parts) if parts else ""

    @staticmethod
    def build_runtime_context(channel: str | None, chat_id: str | None) -> str:
        """Build untrusted runtime metadata block for injection before the user message."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")
        tz = time.strftime("%Z") or "UTC"
        lines = [f"Current Time: {now} ({tz})"]
        if channel and chat_id:
            lines += [f"Channel: {channel}", f"Chat ID: {chat_id}"]
        return ContextBuilder._RUNTIME_CONTEXT_TAG + "\n" + "\n".join(lines)

    def build_messages(
        self,
        history: list[dict[str, Any]],
        current_message: str,
        channel: str | None = None,
        chat_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Build the complete message list for an LLM call."""
        messages = [
            {"role": "system", "content": self.build_system_prompt()},
            *history,
        ]
        
        # 添加运行时上下文
        if channel and chat_id:
            messages.append({"role": "user", "content": self.build_runtime_context(channel, chat_id)})
        
        messages.append({"role": "user", "content": current_message})
        return messages


class Session:
    """Session manager for conversation history."""

    def __init__(self, session_id: str, agent_name: str | None = None):
        self.session_id = session_id
        # session_id 格式：{channel_key}@{chat_id}
        # 用 "@" 分隔：既不会与 channel_key/chat_id 中的下划线冲突，也是合法的文件名字符（Windows 兼容）
        parts = session_id.split("@", 1)
        self.channel = parts[0] if len(parts) > 0 else "unknown"
        self.chat_id = parts[1] if len(parts) > 1 else "unknown"
        
        # 获取 agent_name
        resolved_agent_name = agent_name or config_manager.get(f"channels.{self.channel}.agent_name", "main")
        self.agent_name = resolved_agent_name
        
        # 初始化上下文构建器
        self.context_builder = ContextBuilder(WORKSPACE_DIR, resolved_agent_name)
        
        # 记忆整合相关属性
        self.last_consolidated = 0
        
        # 加载或创建 session 文件
        self._load_session()

    def _load_session(self):
        """加载 session 数据"""
        session_path = WORKSPACE_DIR / "agents" / self.agent_name / "sessions" / f"{self.session_id}.json"
        if session_path.exists():
            print(f"Session {self.session_id} exists")
            with open(session_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    self.messages = data
                    self.last_consolidated = 0
                else:
                    self.messages = data.get("messages", [])
                    self.last_consolidated = data.get("last_consolidated", 0)
        else:
            session_path.parent.mkdir(parents=True, exist_ok=True)
            with open(session_path, "w", encoding="utf-8") as f:
                print(f"Session {self.session_id} created")
                json.dump({"messages": [], "last_consolidated": 0}, f, ensure_ascii=False, indent=2)
                self.messages = []
                self.last_consolidated = 0

    @property
    def session_messages(self):
        """返回 messages 的简化格式，附带精简工具摘要供上下文使用。"""
        result = []
        for m in self.messages:
            content = m["content"]
            summary = m.get("tool_summary")
            if summary and m["role"] == "assistant":
                content = f"{content}\n\n<tool_log>\n{summary}\n</tool_log>" if content else f"<tool_log>\n{summary}\n</tool_log>"
            result.append({"role": m["role"], "content": content})
        return result

    def add_message(self, role: str, content: str, **kwargs):
        """Add a message to the session."""
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            **kwargs
        }
        self.messages.append(message)
        self._save_session()

    def _save_session(self):
        """保存 session 到文件"""
        session_path = WORKSPACE_DIR / "agents" / self.agent_name / "sessions" / f"{self.session_id}.json"
        data = {
            "messages": self.messages,
            "last_consolidated": self.last_consolidated
        }
        with open(session_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_context(self) -> list[dict[str, Any]]:
        """构建完整的消息上下文，使用 ContextBuilder。"""
        return self.context_builder.build_messages(
            history=self.session_messages,
            current_message="",  # 当前消息由调用者添加
            channel=self.channel,
            chat_id=self.chat_id,
        )

    def get_context_with_message(self, message: str) -> list[dict[str, Any]]:
        """构建包含当前消息的完整上下文。"""
        return self.context_builder.build_messages(
            history=self.session_messages,
            current_message=message,
            channel=self.channel,
            chat_id=self.chat_id,
        )

    def trim_messages(self, keep_count: int):
        """整理消息，保留最近 keep_count 条，更新 last_consolidated"""
        if len(self.messages) <= keep_count:
            return
        self.messages = self.messages[-keep_count:]
        self.last_consolidated = 0
        self._save_session()

    def add_tool_result(self, messages: list[dict[str, Any]], tool_call_id: str, tool_name: str, result: str):
        """Add a tool result to the message list."""
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "content": result
        })
        return messages

    def add_assistant_message(
        self,
        messages: list[dict[str, Any]],
        content: str | None,
        tool_calls: list[dict[str, Any]] | None = None,
    ):
        """Add an assistant message to the message list."""
        msg: dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        messages.append(msg)
        return messages
