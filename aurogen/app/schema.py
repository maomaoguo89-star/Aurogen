from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from config.schema import ThinkingLevel


class SetConfigRequest(BaseModel):
    path: str
    value: Any


class SendMessageRequest(BaseModel):
    session_id: str
    message: str
    metadata: Optional[dict] = None


class SessionInfo(BaseModel):
    session_id: str
    channel: str
    chat_id: str
    agent_name: str = ""
    title: str = ""
    message_count: int = 0
    updated_at: Optional[str] = None


class AddChannelRequest(BaseModel):
    key: str           # config key，也是 session_id 前缀，如 "feishu_work"
    type: str          # channel 类型，如 "feishu"
    agent_name: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)


class AddAgentRequest(BaseModel):
    name: str           # agent key，也是 workspace 目录名，如 "assistant"
    display_name: str   # 显示名，对应 AgentConfig.name
    description: str = ""
    model: str
    provider: str
    memory_window: int = 100
    thinking: ThinkingLevel = "none"


class UpdateAgentRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    memory_window: Optional[int] = None
    thinking: Optional[ThinkingLevel] = None


class AddProviderRequest(BaseModel):
    key: str
    type: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)


class UpdateProviderRequest(BaseModel):
    type: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class UpdateChannelRequest(BaseModel):
    agent_name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class CreateChatSessionRequest(BaseModel):
    channel: str = "web"
    chat_id: Optional[str] = None


class CheckAuthRequest(BaseModel):
    password: str


class SetPasswordRequest(BaseModel):
    password: str


class UpdateHeartbeatConfigRequest(BaseModel):
    agent_name: Optional[str] = None
    interval_s: Optional[int] = None
    enabled: Optional[bool] = None


class UpdateCronConfigRequest(BaseModel):
    agent_name: Optional[str] = None
    enabled: Optional[bool] = None


class AddMCPServerRequest(BaseModel):
    key: str
    command: str = ""
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    tool_timeout: int = 30


class UpdateMCPServerRequest(BaseModel):
    command: Optional[str] = None
    args: Optional[list[str]] = None
    env: Optional[dict[str, str]] = None
    url: Optional[str] = None
    headers: Optional[dict[str, str]] = None
    tool_timeout: Optional[int] = None


# ── Skills ─────────────────────────────────────────────────────────────────────

# ── Cron Jobs ──────────────────────────────────────────────────────────────────

class CronScheduleInput(BaseModel):
    kind: Literal["at", "every", "cron"]
    at_ms: Optional[int] = None
    every_ms: Optional[int] = None
    expr: Optional[str] = None
    tz: Optional[str] = None


class AddCronJobRequest(BaseModel):
    name: str
    schedule: CronScheduleInput
    message: str
    deliver: bool = False
    channel: Optional[str] = None
    to: Optional[str] = None
    delete_after_run: bool = False


class UpdateCronJobRequest(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    schedule: Optional[CronScheduleInput] = None
    message: Optional[str] = None
    deliver: Optional[bool] = None
    channel: Optional[str] = None
    to: Optional[str] = None
    delete_after_run: Optional[bool] = None


# ── Skills ─────────────────────────────────────────────────────────────────────

class SkillInfo(BaseModel):
    name: str
    description: str = ""
    source: str              # "builtin" | "workspace"
    agent_name: Optional[str] = None
    available: bool = True
    missing_requirements: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class SkillDetailResponse(BaseModel):
    name: str
    description: str = ""
    source: str
    agent_name: Optional[str] = None
    available: bool = True
    missing_requirements: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    content: str = ""