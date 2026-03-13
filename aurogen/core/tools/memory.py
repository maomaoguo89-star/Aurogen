"""Memory tool for agent profile and long-term memory files."""

from pathlib import Path
import re
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
            "Prefer search for history lookups; use read only when you need the exact full raw file content. "
            "When using search, include query by default. Only omit query for target=history when you explicitly want the most recent entries. "
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
                    "enum": ["read", "search", "write", "edit", "append", "complete_bootstrap"],
                    "description": "The memory action to perform",
                },
                "target": {
                    "type": "string",
                    "enum": list(self._TARGET_FILES.keys()),
                    "description": "Which memory file to operate on",
                },
                "query": {
                    "type": "string",
                    "description": "Keyword or regex to search for when action=search. Required by default. Optional only for target=history when you explicitly want recent entries.",
                },
                "regex": {
                    "type": "boolean",
                    "description": "Treat query as a regex pattern when action=search",
                },
                "case_insensitive": {
                    "type": "boolean",
                    "description": "Case-insensitive matching for search (default true)",
                },
                "context_lines": {
                    "type": "integer",
                    "description": "How many surrounding lines to include around each search hit (default 1)",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of search hits to return (default 10)",
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
        query: str = "",
        regex: bool = False,
        case_insensitive: bool = True,
        context_lines: int = 1,
        max_results: int = 10,
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
                if target == "history":
                    return "history is empty."
                return f"Error: {target} file does not exist yet"
            return path.read_text(encoding="utf-8")

        if action == "search":
            if not path.exists():
                if target == "history":
                    return "history is empty."
                return f"Error: {target} file does not exist yet"
            if not query:
                if target == "history":
                    return self._recent_history(path=path, target=target, max_results=max_results)
                return "Error: query is required for search"
            return self._search_file(
                path=path,
                target=target,
                query=query,
                regex=regex,
                case_insensitive=case_insensitive,
                context_lines=context_lines,
                max_results=max_results,
            )

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

    def _recent_history(self, *, path: Path, target: str, max_results: int) -> str:
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return f"{target} is empty."

        max_results = max(1, min(max_results, 20))
        entries = [chunk.strip() for chunk in re.split(r"\n\s*\n", text) if chunk.strip()]
        if not entries:
            return f"{target} is empty."

        recent = entries[-max_results:]
        return f"Recent entries from {target}\n\n" + "\n\n".join(
            f"[entry {idx}]\n{entry}"
            for idx, entry in enumerate(recent, start=1)
        )

    def _search_file(
        self,
        *,
        path: Path,
        target: str,
        query: str,
        regex: bool,
        case_insensitive: bool,
        context_lines: int,
        max_results: int,
    ) -> str:
        text = path.read_text(encoding="utf-8")
        if not text:
            return f"{target} is empty."

        lines = text.splitlines()
        if not lines:
            return f"{target} is empty."

        context_lines = max(0, min(context_lines, 5))
        max_results = max(1, min(max_results, 20))
        flags = re.IGNORECASE if case_insensitive else 0

        try:
            pattern = re.compile(query if regex else re.escape(query), flags)
        except re.error as exc:
            return f"Error: invalid regex: {exc}"

        hit_indexes = [idx for idx, line in enumerate(lines) if pattern.search(line)]
        if not hit_indexes:
            return f"No matches found in {target} for query: {query}"

        blocks: list[str] = []
        last_end = -1
        for hit_no, idx in enumerate(hit_indexes[:max_results], start=1):
            start = max(0, idx - context_lines)
            end = min(len(lines), idx + context_lines + 1)
            if start <= last_end:
                start = last_end + 1
            if start >= end:
                continue
            snippet = "\n".join(
                f"{line_no + 1}|{lines[line_no]}"
                for line_no in range(start, end)
            )
            blocks.append(f"[match {hit_no}]\n{snippet}")
            last_end = end - 1

        if not blocks:
            return f"No matches found in {target} for query: {query}"

        suffix = ""
        if len(hit_indexes) > max_results:
            suffix = f"\n\n... {len(hit_indexes) - max_results} more matches not shown."

        return (
            f"Search results in {target} for query: {query}\n\n"
            + "\n\n".join(blocks)
            + suffix
        )
