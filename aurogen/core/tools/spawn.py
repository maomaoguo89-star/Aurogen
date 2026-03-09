"""Spawn tool for creating background subagents."""

from typing import Any, TYPE_CHECKING

from core.tools.base import Tool

if TYPE_CHECKING:
    from core.subagent import SubagentManager


class SpawnTool(Tool):
    """
    Tool to spawn a subagent for background task execution.

    The subagent runs asynchronously and announces its result back
    to the main agent when complete.
    """

    def __init__(self, manager: "SubagentManager"):
        self._manager = manager
        self._origin_channel = ""
        self._origin_chat_id = ""
        self._agent_name = "main"

    def set_context(self, channel: str, chat_id: str, agent_name: str) -> None:
        """Set the origin context for subagent announcements."""
        self._origin_channel = channel
        self._origin_chat_id = chat_id
        self._agent_name = agent_name

    @property
    def name(self) -> str:
        return "spawn"

    @property
    def description(self) -> str:
        return (
            "Spawn a subagent to handle a task in the background. "
            "Use this for complex or time-consuming tasks that can run independently. "
            "The subagent will complete the task and report back when done."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task for the subagent to complete",
                },
                "label": {
                    "type": "string",
                    "description": "Optional short label for the task (for display)",
                },
            },
            "required": ["task"],
        }

    async def execute(self, **kwargs: Any) -> str:
        return await self._manager.spawn(
            task=kwargs["task"],
            label=kwargs.get("label"),
            origin_channel=self._origin_channel,
            origin_chat_id=self._origin_chat_id,
            agent_name=self._agent_name,
        )
