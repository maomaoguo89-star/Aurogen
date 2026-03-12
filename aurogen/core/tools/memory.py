"""Memory tool for agent profile and long-term memory files."""

from pathlib import Path
from typing import Any

from config.config import config_manager
from core.tools.base import Tool
from core.tools.filesystem import EditFileTool


class MemoryTool(Tool):
    """Tool for reading and writing structured memory files."""

    _TARGET_FILES = {
        "soul": "SOUL.md",
        "user": "USER.md",
        "memory": "memory/MEMORY.md",
        "history": "memory/HISTORY.md",
    }

    def __init__(self, workspace: Path):
        self._workspace = workspace
        self._agent_name = "main"

    def set_context(self, agent_name: str) -> None:
        """Set the current agent workspace context."""
        self._agent_name = agent_name

    @property
    def name(self) -> str:
        return "memory"

    @property
    def description(self) -> str:
        return (
            "Persist or update identity (soul/user), long-term notes (memory), "
            "and history log (history). Also used to complete bootstrap. "
            "IMPORTANT: Do NOT read files already in your system prompt (soul, user, memory). "
            "Do NOT re-write a file with the same content — only write when you have NEW information. "
            "Do NOT call complete_bootstrap if bootstrap is already done."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "write", "edit", "append", "complete_bootstrap"],
                    "description": "The memory action to perform",
                },
                "target": {
                    "type": "string",
                    "enum": list(self._TARGET_FILES.keys()),
                    "description": "Which memory file to operate on",
                },
                "content": {
                    "type": "string",
                    "description": "Content used by write or append actions",
                },
                "old_text": {
                    "type": "string",
                    "description": "Exact text to replace for edit",
                },
                "new_text": {
                    "type": "string",
                    "description": "Replacement text for edit",
                },
            },
            "required": ["action"],
        }

    def _target_path(self, target: str) -> Path:
        if target not in self._TARGET_FILES:
            raise ValueError(f"Unknown memory target: {target}")
        return self._workspace / "agents" / self._agent_name / self._TARGET_FILES[target]

    async def execute(
        self,
        action: str,
        target: str = "",
        content: str = "",
        old_text: str = "",
        new_text: str = "",
        **kwargs: Any,
    ) -> str:
        if action == "complete_bootstrap":
            already = config_manager.get(f"agents.{self._agent_name}.bootstrap_completed", False)
            if already:
                return f"Bootstrap was already completed for agent {self._agent_name}. No action needed."
            config_manager.set(f"agents.{self._agent_name}.bootstrap_completed", True)
            bootstrap_path = self._workspace / "agents" / self._agent_name / "BOOTSTRAP.md"
            if bootstrap_path.exists():
                try:
                    bootstrap_path.unlink()
                except Exception as exc:
                    return (
                        f"Bootstrap marked complete for agent {self._agent_name}, "
                        f"but failed to delete BOOTSTRAP.md: {exc}"
                    )
            return f"Bootstrap marked complete for agent {self._agent_name}"

        if not target:
            return "Error: target is required for this action"
        path = self._target_path(target)

        if action == "read":
            if not path.exists():
                return f"Error: {target} file does not exist yet"
            return path.read_text(encoding="utf-8")

        if action == "write":
            if not content:
                return "Error: content is required for write"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            return f"Successfully wrote {target} for agent {self._agent_name}"

        if action == "append":
            if not content:
                return "Error: content is required for append"
            path.parent.mkdir(parents=True, exist_ok=True)
            existing = path.read_text(encoding="utf-8") if path.exists() else ""
            if existing and not existing.endswith("\n"):
                existing += "\n"
            path.write_text(existing + content, encoding="utf-8")
            return f"Successfully appended to {target} for agent {self._agent_name}"

        if action == "edit":
            if not old_text:
                return "Error: old_text is required for edit"
            file_content = path.read_text(encoding="utf-8") if path.exists() else ""
            if old_text not in file_content:
                return EditFileTool._not_found_message(old_text, file_content, str(path))
            count = file_content.count(old_text)
            if count > 1:
                return f"Warning: old_text appears {count} times. Please provide more context to make it unique."
            updated = file_content.replace(old_text, new_text, 1)
            path.write_text(updated, encoding="utf-8")
            return f"Successfully edited {target} for agent {self._agent_name}"

        return f"Unknown action: {action}"
