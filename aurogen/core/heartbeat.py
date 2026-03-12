"""Heartbeat service - periodic agent wake-up to check for tasks."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Callable, Coroutine, Iterable

from loguru import logger

from providers.providers import Provider

_HEARTBEAT_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "heartbeat",
            "description": "Report heartbeat decision after reviewing tasks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["skip", "run"],
                        "description": "skip = nothing to do, run = has active tasks",
                    },
                    "tasks": {
                        "type": "string",
                        "description": "Natural-language summary of active tasks (required for run)",
                    },
                },
                "required": ["action"],
            },
        },
    }
]


class HeartbeatService:
    """
    Periodic heartbeat service that wakes the agent to check for tasks.

    Phase 1 (decision): reads HEARTBEAT.md and asks the LLM — via a virtual
    tool call — whether there are active tasks.  This avoids free-text parsing
    and the unreliable HEARTBEAT_OK token.

    Phase 2 (execution): only triggered when Phase 1 returns ``run``.  The
    ``on_execute`` callback runs the task through the full agent loop and
    returns the result to deliver.
    """

    def __init__(
        self,
        workspace: Path,
        on_execute: Callable[[str], Coroutine[Any, Any, str]] | None = None,
        on_notify: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        agent_name: str = "heartbeat",
        interval_s: int = 30 * 60,
        enabled: bool = True,
    ):
        self.workspace = workspace
        self.provider = Provider()
        self.agent_name = agent_name
        self.on_execute = on_execute
        self.on_notify = on_notify
        self.interval_s = interval_s
        self.enabled = enabled
        self._running = False
        self._task: asyncio.Task | None = None

    @property
    def heartbeat_file(self) -> Path:
        return self.workspace / "HEARTBEAT.md"

    def _read_heartbeat_file(self) -> str | None:
        if self.heartbeat_file.exists():
            try:
                return self.heartbeat_file.read_text(encoding="utf-8")
            except Exception:
                return None
        return None

    async def _decide(self, content: str) -> tuple[str, str]:
        """Phase 1: ask LLM to decide skip/run via virtual tool call.

        Returns (action, tasks) where action is 'skip' or 'run'.
        """
        response = await asyncio.to_thread(
            self.provider.response,
            messages=[
                {
                    "role": "system",
                    "content": "You are a heartbeat agent. Call the heartbeat tool to report your decision.",
                },
                {
                    "role": "user",
                    "content": (
                        "Review the following HEARTBEAT.md and decide whether there are active tasks.\n\n"
                        f"{content}"
                    ),
                },
            ],
            tools=_HEARTBEAT_TOOL,
            agent_name=self.agent_name,
        )

        if not (hasattr(response, "choices") and response.choices):
            return "skip", ""

        msg = response.choices[0].message
        if not (hasattr(msg, "tool_calls") and msg.tool_calls):
            return "skip", ""

        args = msg.tool_calls[0].function.arguments
        if isinstance(args, str):
            args = json.loads(args)
        return args.get("action", "skip"), args.get("tasks", "")

    async def start(self) -> None:
        """Start the heartbeat service."""
        if not self.enabled:
            logger.info("Heartbeat disabled")
            return
        if self._running:
            logger.warning("Heartbeat already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Heartbeat started (every {}s)", self.interval_s)

    def stop(self) -> None:
        """Stop the heartbeat service."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _run_loop(self) -> None:
        """Main heartbeat loop."""
        while self._running:
            try:
                await asyncio.sleep(self.interval_s)
                if self._running:
                    await self._tick()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Heartbeat error: {}", e)

    async def _tick(self) -> None:
        """Execute a single heartbeat tick."""
        content = self._read_heartbeat_file()
        if not content:
            logger.debug("Heartbeat: HEARTBEAT.md missing or empty")
            return

        logger.info("Heartbeat: checking for tasks...")

        try:
            action, tasks = await self._decide(content)

            if action != "run":
                logger.info("Heartbeat: OK (nothing to report)")
                return

            logger.info("Heartbeat: tasks found, executing...")
            if self.on_execute:
                response = await self.on_execute(tasks)
                if response and self.on_notify:
                    logger.info("Heartbeat: completed, delivering response")
                    await self.on_notify(response)
        except Exception:
            logger.exception("Heartbeat execution failed")

    async def trigger_now(self) -> str | None:
        """Manually trigger a heartbeat."""
        content = self._read_heartbeat_file()
        if not content:
            return None
        action, tasks = await self._decide(content)
        if action != "run" or not self.on_execute:
            return None
        return await self.on_execute(tasks)


class HeartbeatManager:
    """Manage one heartbeat service per agent."""

    def __init__(
        self,
        workspace_root: Path,
        config_resolver: Callable[[str], dict[str, Any]],
        on_execute_factory: Callable[[str], Callable[[str], Coroutine[Any, Any, str]]],
        on_notify_factory: Callable[[str], Callable[[str], Coroutine[Any, Any, None]]],
    ):
        self.workspace_root = workspace_root
        self._config_resolver = config_resolver
        self._on_execute_factory = on_execute_factory
        self._on_notify_factory = on_notify_factory
        self._services: dict[str, HeartbeatService] = {}

    def _build_service(self, agent_name: str) -> HeartbeatService:
        cfg = self._config_resolver(agent_name)
        return HeartbeatService(
            workspace=self.workspace_root / "agents" / agent_name,
            on_execute=self._on_execute_factory(agent_name),
            on_notify=self._on_notify_factory(agent_name),
            agent_name=agent_name,
            interval_s=cfg.get("interval_s", 1800),
            enabled=cfg.get("enabled", True),
        )

    def sync_agents(self, agent_names: Iterable[str]) -> None:
        """Reconcile managed services with configured agents."""
        desired = set(agent_names)
        for stale_agent in set(self._services) - desired:
            self.remove_agent(stale_agent)
        for agent_name in desired:
            self._replace_service(agent_name)

    def _replace_service(self, agent_name: str) -> HeartbeatService:
        existing = self._services.pop(agent_name, None)
        if existing:
            existing.stop()
        service = self._build_service(agent_name)
        self._services[agent_name] = service
        return service

    async def start_all(self) -> None:
        """Start all managed heartbeat services."""
        for service in self._services.values():
            await service.start()

    def stop_all(self) -> None:
        """Stop all managed heartbeat services."""
        for service in self._services.values():
            service.stop()

    async def rebuild_agent(self, agent_name: str) -> None:
        """Rebuild and restart the heartbeat service for one agent."""
        service = self._replace_service(agent_name)
        await service.start()

    def remove_agent(self, agent_name: str) -> None:
        """Stop and remove the heartbeat service for one agent."""
        service = self._services.pop(agent_name, None)
        if service:
            service.stop()

    def status(self) -> dict[str, Any]:
        """Return aggregated heartbeat runtime status."""
        instances = {}
        for agent_name, service in sorted(self._services.items()):
            cfg = self._config_resolver(agent_name)
            instances[agent_name] = {
                "running": service._running,
                "interval_s": cfg.get("interval_s", service.interval_s),
                "enabled": cfg.get("enabled", service.enabled),
            }
        return {
            "running": any(item["running"] for item in instances.values()),
            "instances": instances,
        }
