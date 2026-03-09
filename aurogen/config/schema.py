from pydantic import BaseModel, Field
from typing import Any, Dict, Literal

ThinkingLevel = Literal["none", "low", "medium", "high"]


class ModelSettings(BaseModel):
    model: str
    provider: str
    memory_window: int = 100
    thinking: ThinkingLevel = "none"


class AgentConfig(BaseModel):
    name: str
    description: str
    model_settings: ModelSettings


class ProviderConfig(BaseModel):
    type: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)


class ChannelConfig(BaseModel):
    type: str                   # channel 类型，对应 CHANNEL_REGISTRY 中的 key，如 "web" / "feishu"
    agent_name: str
    description: str = ""
    settings: dict = {}         # channel 类型专属配置（凭证等），schema 不感知细节


class MCPServerConfig(BaseModel):
    command: str = ""
    args: list[str] = []
    env: dict[str, str] = {}
    url: str = ""
    headers: dict[str, str] = {}
    tool_timeout: int = 30


class AuthConfig(BaseModel):
    password: str = ""
    first_login: bool = True


class HeartbeatConfig(BaseModel):
    agent_name: str = "main"
    interval_s: int = 1800
    enabled: bool = True


class CronConfig(BaseModel):
    agent_name: str = "main"
    enabled: bool = True


class AppConfig(BaseModel):
    agents: Dict[str, AgentConfig] = {}
    providers: Dict[str, ProviderConfig] = {}
    channels: Dict[str, ChannelConfig] = {}
    mcp: Dict[str, MCPServerConfig] = {}
    auth: AuthConfig = Field(default_factory=AuthConfig)
    heartbeat: HeartbeatConfig = Field(default_factory=HeartbeatConfig)
    cron: CronConfig = Field(default_factory=CronConfig)
