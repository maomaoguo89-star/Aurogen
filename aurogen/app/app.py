import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from app.schema import (
    AddAgentRequest,
    AddChannelRequest,
    AddCronJobRequest,
    AddMCPServerRequest,
    AddProviderRequest,
    CheckAuthRequest,
    CreateChatSessionRequest,
    SendMessageRequest,
    SessionInfo,
    SetConfigRequest,
    SetPasswordRequest,
    SkillDetailResponse,
    SkillInfo,
    UpdateAgentRequest,
    UpdateChannelRequest,
    UpdateCronConfigRequest,
    UpdateCronJobRequest,
    UpdateHeartbeatConfigRequest,
    UpdateMCPServerRequest,
    UpdateProviderRequest,
    WriteFileRequest,
)
from cron.types import CronSchedule
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from config.config import config_manager, WORKSPACE_DIR, TEMPLATE_DIR
from channels.manager import get_channel_manager, _build_registry
from channels.web import WebChannel
from message.queue_manager import get_inbound_queue
from message.events import EventType, InboundMessage
from message.session_manager import Session
from core.core import AgentLoop
from core.skills import SkillsLoader, get_skills_loader, resolve_skills_dir
from providers.providers import Provider, _build_provider_registry
from core.heartbeat import HeartbeatService

agent_loop: AgentLoop | None = None
heartbeat_service: HeartbeatService | None = None


def _ensure_main_agent():
    """If the main agent workspace is missing or empty, seed it from the template."""
    import shutil
    agent_dir = WORKSPACE_DIR / "agents" / "main"
    if agent_dir.exists() and any(agent_dir.iterdir()):
        return
    logger.info("[App] main agent 工作区为空，从 template 初始化")
    agent_dir.mkdir(parents=True, exist_ok=True)
    for src in TEMPLATE_DIR.rglob("*"):
        if src.suffix in (".py", ".pyc") or "__pycache__" in src.parts:
            continue
        dst = agent_dir / src.relative_to(TEMPLATE_DIR)
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(src, dst)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 生命周期管理：启动和关闭 agent loop 及所有 channel。"""
    global agent_loop, heartbeat_service

    _ensure_main_agent()

    # 从 config 加载并启动所有 channel
    channel_manager = get_channel_manager()
    await channel_manager.load_from_config()

    provider = Provider()
    agent_loop = AgentLoop(provider, workspace=WORKSPACE_DIR)

    async def _on_execute(tasks: str) -> str:
        msg = InboundMessage(session_id="web@heartbeat", content=tasks)
        await get_inbound_queue().put(msg)
        return f"Heartbeat task queued: {tasks[:80]}"

    async def _on_notify(response: str) -> None:
        logger.info("Heartbeat result: {}", response)

    hb_cfg = config_manager.get("heartbeat", {})
    heartbeat_service = HeartbeatService(
        workspace=WORKSPACE_DIR / "agents" / "main",
        on_execute=_on_execute,
        on_notify=_on_notify,
        agent_name=hb_cfg.get("agent_name", "heartbeat"),
        interval_s=hb_cfg.get("interval_s", 1800),
        enabled=hb_cfg.get("enabled", True),
    )

    task = asyncio.create_task(agent_loop.run())
    await heartbeat_service.start()
    logger.info("[App] Agent loop 已启动，已加载 channel: {}", list(channel_manager._channels.keys()))

    yield  # 应用运行中

    agent_loop.stop()
    heartbeat_service.stop()
    await channel_manager.stop_all()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("[App] Agent loop 已停止")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH_PUBLIC_PATHS = {"/check-auth", "/set-password", "/docs", "/openapi.json"}

_STATIC_EXTS = {
    ".js", ".css", ".html", ".ico", ".png", ".svg",
    ".woff", ".woff2", ".ttf", ".map", ".json", ".webmanifest",
}

# SPA 入口文件路径（Docker 部署时存在，本地开发时不存在）
_SPA_INDEX = Path(__file__).resolve().parent.parent.parent / "aurogen_web" / "dist" / "index.html"


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path in AUTH_PUBLIC_PATHS:
        return await call_next(request)

    # 静态文件资源（有扩展名或根路径）不需要鉴权
    if request.url.path == "/" or Path(request.url.path).suffix in _STATIC_EXTS:
        return await call_next(request)

    # 浏览器页面导航（刷新 SPA 路由）→ 直接返回 index.html，让前端路由接管
    # 避免与同名 API 端点冲突导致 401，SPA 加载后自行处理登录态
    if "text/html" in request.headers.get("Accept", "") and _SPA_INDEX.exists():
        return FileResponse(_SPA_INDEX)

    auth_cfg = config_manager.get("auth", {})
    stored_password = auth_cfg.get("password", "")
    first_login = auth_cfg.get("first_login", True)

    if first_login and stored_password == "":
        return await call_next(request)

    auth_key = request.headers.get("X-Auth-Key", "")
    if auth_key != stored_password:
        return JSONResponse(status_code=401, content={"detail": "认证失败"})

    return await call_next(request)


# ── 认证端点 ──────────────────────────────────────────────────────────────────


@app.post("/check-auth")
async def check_auth(request: CheckAuthRequest):
    auth_cfg = config_manager.get("auth", {})
    stored_password = auth_cfg.get("password", "")
    first_login = auth_cfg.get("first_login", True)

    if first_login and stored_password == "":
        return {"status": "first_login"}
    if request.password == stored_password:
        return {"status": "success"}
    return {"status": "failed"}


@app.post("/set-password")
async def set_password(request: SetPasswordRequest):
    auth_cfg = config_manager.get("auth", {})
    if not auth_cfg.get("first_login", False):
        raise HTTPException(status_code=403, detail="非首次登录，无法设置密码")
    if not request.password:
        raise HTTPException(status_code=400, detail="密码不能为空")

    config_manager.set("auth.password", request.password)
    config_manager.set("auth.first_login", False)
    return {"status": "success"}


# ── 配置端点 ──────────────────────────────────────────────────────────────────

@app.post("/set-config")
async def set_config(request: SetConfigRequest):
    config_manager.set(request.path, request.value)
    return {"message": "Config set successfully"}


@app.get("/get-config")
async def get_config():
    return {"config": config_manager.get_full_config()}


# ── MCP 管理端点 ─────────────────────────────────────────────────────────────


def _get_loaded_mcp_tools(server_key: str) -> list[str]:
    """Return currently loaded tool names belonging to a specific MCP server."""
    if not agent_loop:
        return []
    prefix = f"mcp_{server_key}_"
    return [
        name for name in getattr(agent_loop.tools, "tool_names", [])
        if name.startswith(prefix)
    ]


def _build_mcp_entry(key: str, cfg: dict) -> dict:
    loaded = _get_loaded_mcp_tools(key)
    return {
        "key": key,
        **cfg,
        "loaded_tools": loaded,
        "loaded_count": len(loaded),
    }


def _validate_mcp_server_config(command: str, url: str) -> None:
    if not command and not url:
        raise HTTPException(
            status_code=400,
            detail="MCP server 必须配置 command 或 url 中的至少一个",
        )


@app.get("/mcp/config")
async def get_mcp_config():
    """返回所有已配置的 MCP servers 及其加载状态。"""
    mcp_cfg: dict = config_manager.get("mcp", {})
    return {
        "servers": [
            _build_mcp_entry(key, cfg)
            for key, cfg in mcp_cfg.items()
        ]
    }


@app.get("/mcp/{key}")
async def get_mcp_detail(key: str):
    """返回单个 MCP server 详情。"""
    cfg = config_manager.get(f"mcp.{key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' 不存在")
    return _build_mcp_entry(key, cfg)


@app.post("/mcp")
async def add_mcp_server(request: AddMCPServerRequest):
    """新增 MCP server 配置并自动连接。"""
    if config_manager.get(f"mcp.{request.key}"):
        raise HTTPException(status_code=400, detail=f"MCP server '{request.key}' 已存在")

    _validate_mcp_server_config(request.command, request.url)

    config_manager.set(f"mcp.{request.key}", {
        "command": request.command,
        "args": request.args,
        "env": request.env,
        "url": request.url,
        "headers": request.headers,
        "tool_timeout": request.tool_timeout,
    })

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{request.key}' 已添加并加载"}


@app.patch("/mcp/{key}")
async def update_mcp_server(key: str, request: UpdateMCPServerRequest):
    """部分更新 MCP server 配置并自动重连。"""
    existing = config_manager.get(f"mcp.{key}")
    if not existing:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' 不存在")

    merged = dict(existing)
    if request.command is not None:
        merged["command"] = request.command
    if request.args is not None:
        merged["args"] = request.args
    if request.env is not None:
        merged["env"] = request.env
    if request.url is not None:
        merged["url"] = request.url
    if request.headers is not None:
        merged["headers"] = request.headers
    if request.tool_timeout is not None:
        merged["tool_timeout"] = request.tool_timeout

    _validate_mcp_server_config(merged.get("command", ""), merged.get("url", ""))

    config_manager.set(f"mcp.{key}", merged)

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{key}' 已更新并重新加载"}


@app.delete("/mcp/{key}")
async def delete_mcp_server(key: str):
    """删除 MCP server 配置并卸载其工具。"""
    mcp_cfg: dict = config_manager.get("mcp", {})
    if key not in mcp_cfg:
        raise HTTPException(status_code=404, detail=f"MCP server '{key}' 不存在")

    mcp_cfg.pop(key, None)
    config_manager.set("mcp", mcp_cfg)

    if agent_loop:
        await agent_loop.reload_mcp()

    return {"message": f"MCP server '{key}' 已删除"}


@app.post("/mcp/reload")
async def reload_mcp():
    """重新读取 config 并重连所有 MCP servers。"""
    if agent_loop is None:
        raise HTTPException(status_code=503, detail="Agent loop 未启动")
    await agent_loop.reload_mcp()
    return {"message": "MCP servers reloaded"}


# ── Heartbeat 配置端点 ────────────────────────────────────────────────────────

@app.get("/heartbeat/config")
async def get_heartbeat_config():
    """返回当前 heartbeat 配置。"""
    cfg = config_manager.get("heartbeat", {})
    return {
        "agent_name": cfg.get("agent_name", "heartbeat"),
        "interval_s": cfg.get("interval_s", 1800),
        "enabled": cfg.get("enabled", True),
    }


@app.patch("/heartbeat/config")
async def update_heartbeat_config(request: UpdateHeartbeatConfigRequest):
    """部分更新 heartbeat 配置，并重启 heartbeat 服务使配置生效。"""
    global heartbeat_service
    existing = config_manager.get("heartbeat", {})
    merged = dict(existing)

    if request.agent_name is not None:
        _require_agent(request.agent_name)
        merged["agent_name"] = request.agent_name
    if request.interval_s is not None:
        if request.interval_s <= 0:
            raise HTTPException(status_code=400, detail="interval_s 必须大于 0")
        merged["interval_s"] = request.interval_s
    if request.enabled is not None:
        merged["enabled"] = request.enabled

    config_manager.set("heartbeat", merged)

    if heartbeat_service is not None:
        heartbeat_service.stop()
        heartbeat_service.agent_name = merged.get("agent_name", "heartbeat")
        heartbeat_service.interval_s = merged.get("interval_s", 1800)
        heartbeat_service.enabled = merged.get("enabled", True)
        await heartbeat_service.start()

    return {"message": "heartbeat 配置已更新"}


# ── Cron 配置端点 ─────────────────────────────────────────────────────────────

@app.get("/cron/config")
async def get_cron_config():
    """返回当前 cron 配置。"""
    cfg = config_manager.get("cron", {})
    return {
        "agent_name": cfg.get("agent_name", "main"),
        "enabled": cfg.get("enabled", True),
    }


@app.patch("/cron/config")
async def update_cron_config(request: UpdateCronConfigRequest):
    """部分更新 cron 配置。"""
    existing = config_manager.get("cron", {})
    merged = dict(existing)

    if request.agent_name is not None:
        _require_agent(request.agent_name)
        merged["agent_name"] = request.agent_name
    if request.enabled is not None:
        merged["enabled"] = request.enabled

    config_manager.set("cron", merged)
    return {"message": "cron 配置已更新"}


# ── Cron Job 管理端点 ─────────────────────────────────────────────────────────


def _cron_service():
    """返回运行中的 CronService，未就绪时抛 503。"""
    if agent_loop is None:
        raise HTTPException(status_code=503, detail="Agent loop 未启动")
    return agent_loop.cron_service


def _build_cron_job_entry(job) -> dict:
    return {
        "id": job.id,
        "name": job.name,
        "enabled": job.enabled,
        "schedule": {
            "kind": job.schedule.kind,
            "at_ms": job.schedule.at_ms,
            "every_ms": job.schedule.every_ms,
            "expr": job.schedule.expr,
            "tz": job.schedule.tz,
        },
        "payload": {
            "kind": job.payload.kind,
            "message": job.payload.message,
            "deliver": job.payload.deliver,
            "channel": job.payload.channel,
            "to": job.payload.to,
        },
        "state": {
            "next_run_at_ms": job.state.next_run_at_ms,
            "last_run_at_ms": job.state.last_run_at_ms,
            "last_status": job.state.last_status,
            "last_error": job.state.last_error,
        },
        "created_at_ms": job.created_at_ms,
        "updated_at_ms": job.updated_at_ms,
        "delete_after_run": job.delete_after_run,
    }


@app.get("/cron/status")
async def get_cron_status():
    """返回 cron 服务运行状态及统计信息。"""
    svc = _cron_service()
    return svc.status()


@app.get("/cron/jobs")
async def list_cron_jobs(include_disabled: bool = False):
    """列出所有 cron job。include_disabled=true 时包含已禁用的 job。"""
    svc = _cron_service()
    jobs = svc.list_jobs(include_disabled=include_disabled)
    return {"jobs": [_build_cron_job_entry(j) for j in jobs]}


@app.get("/cron/jobs/{job_id}")
async def get_cron_job(job_id: str):
    """获取单个 cron job 详情。"""
    svc = _cron_service()
    jobs = svc.list_jobs(include_disabled=True)
    for job in jobs:
        if job.id == job_id:
            return _build_cron_job_entry(job)
    raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")


@app.post("/cron/jobs")
async def add_cron_job(request: AddCronJobRequest):
    """新增 cron job。"""
    svc = _cron_service()
    schedule = CronSchedule(
        kind=request.schedule.kind,
        at_ms=request.schedule.at_ms,
        every_ms=request.schedule.every_ms,
        expr=request.schedule.expr,
        tz=request.schedule.tz,
    )
    try:
        job = svc.add_job(
            name=request.name,
            schedule=schedule,
            message=request.message,
            deliver=request.deliver,
            channel=request.channel,
            to=request.to,
            delete_after_run=request.delete_after_run,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"cron job '{job.id}' 已创建", "job": _build_cron_job_entry(job)}


@app.patch("/cron/jobs/{job_id}")
async def update_cron_job(job_id: str, request: UpdateCronJobRequest):
    """部分更新 cron job。"""
    svc = _cron_service()
    schedule = None
    if request.schedule is not None:
        schedule = CronSchedule(
            kind=request.schedule.kind,
            at_ms=request.schedule.at_ms,
            every_ms=request.schedule.every_ms,
            expr=request.schedule.expr,
            tz=request.schedule.tz,
        )
    try:
        job = svc.update_job(
            job_id=job_id,
            name=request.name,
            enabled=request.enabled,
            schedule=schedule,
            message=request.message,
            deliver=request.deliver,
            channel=request.channel,
            to=request.to,
            delete_after_run=request.delete_after_run,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")
    return {"message": f"cron job '{job_id}' 已更新", "job": _build_cron_job_entry(job)}


@app.delete("/cron/jobs/{job_id}")
async def delete_cron_job(job_id: str):
    """删除 cron job。"""
    svc = _cron_service()
    removed = svc.remove_job(job_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")
    return {"message": f"cron job '{job_id}' 已删除"}


@app.post("/cron/jobs/{job_id}/enable")
async def enable_cron_job(job_id: str):
    """启用 cron job。"""
    svc = _cron_service()
    job = svc.enable_job(job_id, enabled=True)
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")
    return {"message": f"cron job '{job_id}' 已启用", "job": _build_cron_job_entry(job)}


@app.post("/cron/jobs/{job_id}/disable")
async def disable_cron_job(job_id: str):
    """禁用 cron job。"""
    svc = _cron_service()
    job = svc.enable_job(job_id, enabled=False)
    if job is None:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")
    return {"message": f"cron job '{job_id}' 已禁用", "job": _build_cron_job_entry(job)}


@app.post("/cron/jobs/{job_id}/run")
async def run_cron_job(job_id: str):
    """手动立即触发 cron job（强制执行，即使已禁用）。"""
    svc = _cron_service()
    ran = await svc.run_job(job_id, force=True)
    if not ran:
        raise HTTPException(status_code=404, detail=f"cron job '{job_id}' 不存在")
    return {"message": f"cron job '{job_id}' 已触发"}


# ── Provider 管理端点 ─────────────────────────────────────────────────────────


def _require_provider_type(provider_type: str):
    registry = _build_provider_registry()
    info = registry.get(provider_type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"不支持的 provider 类型: {provider_type}")
    return info


def _validate_provider_config(provider_type: str, settings: dict) -> None:
    info = _require_provider_type(provider_type)
    missing = [key for key in info.required_settings if key not in settings or settings[key] is None]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"provider 类型 '{provider_type}' 缺少必填 settings",
                "missing_settings": missing,
            },
        )


def _get_provider_usages(provider_key: str) -> list[str]:
    agents_cfg: dict = config_manager.get("agents", {})
    return [
        agent_key
        for agent_key, agent_cfg in agents_cfg.items()
        if agent_cfg.get("provider") == provider_key
    ]


def _get_agent_usages(agent_name: str) -> list[str]:
    channels_cfg: dict = config_manager.get("channels", {})
    return [
        channel_key
        for channel_key, channel_cfg in channels_cfg.items()
        if channel_cfg.get("agent_name") == agent_name
    ]


def _require_agent(agent_name: str) -> dict:
    cfg = config_manager.get(f"agents.{agent_name}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"agent '{agent_name}' 不存在")
    return cfg


def _require_channel(channel_key: str) -> dict:
    cfg = config_manager.get(f"channels.{channel_key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"channel '{channel_key}' 不存在")
    return cfg


def _require_provider(provider_key: str) -> dict:
    cfg = config_manager.get(f"providers.{provider_key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"provider '{provider_key}' 不存在")
    return cfg


def _build_agent_entry(agent_key: str, cfg: dict) -> dict:
    return {
        "key": agent_key,
        "builtin": agent_key in BUILTIN_AGENTS,
        "name": cfg.get("name", ""),
        "description": cfg.get("description", ""),
        "provider": cfg.get("provider", ""),
        "emoji": cfg.get("emoji", ""),
    }


def _build_channel_entry(channel_key: str, cfg: dict) -> dict:
    registry = _build_registry()
    channel_type = cfg.get("type", channel_key)
    info = registry.get(channel_type)
    channel = get_channel_manager().get(channel_key)
    return {
        "key": channel_key,
        "type": channel_type,
        "agent_name": cfg.get("agent_name", ""),
        "description": cfg.get("description", ""),
        "settings": cfg.get("settings", {}),
        "builtin": bool(info and info.builtin),
        "running": getattr(channel, "_running", True) if channel else False,
        "emoji": cfg.get("emoji", ""),
    }


def _build_provider_entry(provider_key: str, cfg: dict) -> dict:
    return {
        "key": provider_key,
        "type": cfg.get("type", provider_key),
        "description": cfg.get("description", ""),
        "settings": cfg.get("settings", {}),
        "model": cfg.get("model", ""),
        "memory_window": cfg.get("memory_window", 100),
        "thinking": cfg.get("thinking", "none"),
        "emoji": cfg.get("emoji", ""),
        "used_by_agents": _get_provider_usages(provider_key),
    }


def _validate_agent_provider(provider_key: str) -> None:
    _require_provider(provider_key)


def _validate_channel_agent(agent_name: str) -> None:
    _require_agent(agent_name)


def _count_total_sessions() -> int:
    total = 0
    agents_dir = WORKSPACE_DIR / "agents"
    if not agents_dir.exists():
        return 0
    for sessions_dir in agents_dir.glob("*/sessions"):
        total += len(list(sessions_dir.glob("*.json")))
    return total


def _get_session_file(channel: str, session_id: str) -> tuple[str, Path]:
    if "/" in session_id or "\\" in session_id:
        raise HTTPException(status_code=400, detail="session_id 非法")
    if "@" in session_id and session_id.split("@", 1)[0] != channel:
        raise HTTPException(status_code=400, detail="session_id 与 channel 不匹配")

    agent_name = config_manager.get(f"channels.{channel}.agent_name", "main")
    session_file = WORKSPACE_DIR / "agents" / agent_name / "sessions" / f"{session_id}.json"
    return agent_name, session_file


def _build_session_info(session_id: str, session_file: Path, agent_name: str) -> SessionInfo:
    """从 session 文件提取展示用元数据。"""
    parts = session_id.split("@", 1)
    channel = parts[0] if len(parts) > 0 else "unknown"
    chat_id = parts[1] if len(parts) > 1 else "unknown"

    title = ""
    message_count = 0
    updated_at = None

    try:
        data = json.loads(session_file.read_text(encoding="utf-8"))
        messages: list = data.get("messages", data) if isinstance(data, dict) else data
        for msg in messages:
            role = msg.get("role", "")
            if role in ("user", "assistant"):
                message_count += 1
            if not title and role == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    title = content[:40]
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            title = part.get("text", "")[:40]
                            break
            if msg.get("timestamp"):
                updated_at = msg["timestamp"]
    except Exception:
        pass

    return SessionInfo(
        session_id=session_id,
        channel=channel,
        chat_id=chat_id,
        agent_name=agent_name,
        title=title,
        message_count=message_count,
        updated_at=updated_at,
    )


@app.get("/providers/supported")
async def get_supported_providers():
    """返回所有支持的 provider 类型及其所需配置字段。"""
    registry = _build_provider_registry()
    return {
        "supported": [
            {
                "type": key,
                "description": info.description,
                "required_settings": info.required_settings,
                "optional_settings": info.optional_settings,
            }
            for key, info in registry.items()
        ]
    }


@app.get("/providers/config")
async def get_providers_config():
    """返回当前所有已配置的 provider 实例。"""
    providers_cfg: dict = config_manager.get("providers", {})
    return {
        "providers": [
            _build_provider_entry(key, cfg)
            for key, cfg in providers_cfg.items()
        ]
    }


@app.get("/providers/{key}")
async def get_provider_detail(key: str):
    """返回单个 provider 实例详情。"""
    cfg = _require_provider(key)
    return _build_provider_entry(key, cfg)


@app.post("/providers")
async def add_provider(request: AddProviderRequest):
    """新增 provider 配置。"""
    if config_manager.get(f"providers.{request.key}"):
        raise HTTPException(status_code=400, detail=f"provider '{request.key}' 已存在")

    _validate_provider_config(request.type, request.settings)
    config_manager.set(
        f"providers.{request.key}",
        {
            "type": request.type,
            "description": request.description,
            "settings": request.settings,
            "model": request.model,
            "memory_window": request.memory_window,
            "thinking": request.thinking,
            "emoji": request.emoji,
        },
    )
    return {"message": f"provider '{request.key}' 已添加"}


@app.patch("/providers/{key}")
async def update_provider(key: str, request: UpdateProviderRequest):
    """部分更新 provider 配置。"""
    existing_cfg = config_manager.get(f"providers.{key}")
    if not existing_cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' 不存在")

    merged_cfg = dict(existing_cfg)
    if request.type is not None:
        merged_cfg["type"] = request.type
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.settings is not None:
        merged_cfg["settings"] = {**existing_cfg.get("settings", {}), **request.settings}
    if request.model is not None:
        merged_cfg["model"] = request.model
    if request.memory_window is not None:
        if request.memory_window <= 0:
            raise HTTPException(status_code=400, detail="memory_window 必须大于 0")
        merged_cfg["memory_window"] = request.memory_window
    if request.thinking is not None:
        merged_cfg["thinking"] = request.thinking
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    provider_type = merged_cfg.get("type", key)
    settings = merged_cfg.get("settings", {})
    _validate_provider_config(provider_type, settings)
    config_manager.set(f"providers.{key}", merged_cfg)
    return {"message": f"provider '{key}' 已更新"}


@app.delete("/providers/{key}")
async def delete_provider(key: str):
    """删除 provider 配置；如果仍被 agent 引用则拒绝删除。"""
    providers_cfg: dict = config_manager.get("providers", {})
    if key not in providers_cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' 不存在")

    used_by = _get_provider_usages(key)
    if used_by:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"provider '{key}' 正在被 agent 引用，无法删除",
                "used_by_agents": used_by,
            },
        )

    providers_cfg.pop(key, None)
    config_manager.set("providers", providers_cfg)
    return {"message": f"provider '{key}' 已删除"}


@app.post("/providers/{key}/test")
async def test_provider(key: str):
    """向 provider 发送一条极简消息以验证连通性。"""
    cfg = config_manager.get(f"providers.{key}")
    if not cfg:
        raise HTTPException(status_code=404, detail=f"provider '{key}' 不存在")

    registry = _build_provider_registry()
    provider_type = cfg.get("type", key)
    info = registry.get(provider_type)
    if not info:
        raise HTTPException(status_code=400, detail=f"不支持的 provider 类型: {provider_type}")

    model = cfg.get("model", "")
    if not model:
        raise HTTPException(status_code=400, detail="provider 未配置 model")

    settings = cfg.get("settings", {})
    adapter = info.cls(**settings)

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: adapter.response(
                model,
                [{"role": "user", "content": "Hi"}],
                None,
                thinking="none",
            ),
        )
        reply = (result.content or "")[:200]
        return {"ok": True, "reply": reply}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Channel 管理端点 ──────────────────────────────────────────────────────────

@app.get("/channels")
async def list_channels():
    """列出当前已注册的 channel 及其状态。"""
    return get_channel_manager().status()


@app.get("/channels/config")
async def get_channels_config():
    """返回所有已配置的 channel 的详细信息（含 web），包括 settings、description、agent_name。"""
    channels_cfg: dict = config_manager.get("channels", {})
    return {
        "channels": [
            _build_channel_entry(key, cfg)
            for key, cfg in channels_cfg.items()
        ]
    }


@app.get("/channels/supported")
async def get_supported_channels():
    """返回所有可配置的 channel 类型（内置 builtin channel 如 web 被过滤）。"""
    registry = _build_registry()
    return {
        "supported": [
            {
                "type": type_key,
                "description": info.description,
                "required_settings": info.required_settings,
            }
            for type_key, info in registry.items()
            if not info.builtin
        ]
    }


@app.get("/channels/{key}")
async def get_channel_detail(key: str):
    """返回单个 channel 实例详情。"""
    cfg = _require_channel(key)
    return _build_channel_entry(key, cfg)


@app.post("/channels")
async def add_channel(request: AddChannelRequest):
    """写入 config 并启动一个新 channel 实例。builtin 类型（如 web）不允许添加。"""
    registry = _build_registry()
    info = registry.get(request.type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"不支持的 channel 类型: {request.type}")
    if info.builtin:
        raise HTTPException(status_code=400, detail=f"channel 类型 '{request.type}' 为内置类型，不可通过 API 添加")
    if request.key in get_channel_manager()._channels:
        raise HTTPException(status_code=400, detail=f"channel '{request.key}' 已存在")

    cfg = {
        "type": request.type,
        "agent_name": request.agent_name,
        "description": request.description,
        "settings": request.settings,
        "emoji": request.emoji,
    }
    config_manager.set(f"channels.{request.key}", cfg)
    await get_channel_manager()._start_channel(request.key, info, cfg)
    return {"message": f"channel '{request.key}' 已添加并启动"}


@app.patch("/channels/{key}")
async def update_channel(key: str, request: UpdateChannelRequest):
    """部分更新 channel 配置，并在运行中时重启该 channel 使配置生效。"""
    existing_cfg = _require_channel(key)
    channel_type = existing_cfg.get("type", key)
    registry = _build_registry()
    info = registry.get(channel_type)
    if info is None:
        raise HTTPException(status_code=400, detail=f"不支持的 channel 类型: {channel_type}")

    merged_cfg = dict(existing_cfg)
    if request.agent_name is not None:
        _validate_channel_agent(request.agent_name)
        merged_cfg["agent_name"] = request.agent_name
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.settings is not None:
        merged_cfg["settings"] = {**existing_cfg.get("settings", {}), **request.settings}
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    config_manager.set(f"channels.{key}", merged_cfg)
    if get_channel_manager().get(key) is not None:
        await get_channel_manager()._stop_channel(key)
        await get_channel_manager()._start_channel(key, info, merged_cfg)
    return {"message": f"channel '{key}' 已更新"}


@app.delete("/channels/{key}")
async def delete_channel(key: str):
    """停止并移除一个 channel 实例。内置 channel（如 web）不允许删除。"""
    registry = _build_registry()
    channel = get_channel_manager().get(key)
    if channel is None:
        raise HTTPException(status_code=404, detail=f"channel '{key}' 不存在")

    channel_type = config_manager.get(f"channels.{key}.type", key)
    info = registry.get(channel_type)
    if info and info.builtin:
        raise HTTPException(status_code=400, detail=f"channel '{key}' 为内置 channel，不可删除")

    await get_channel_manager()._stop_channel(key)
    cfg = config_manager.get("channels", {})
    cfg.pop(key, None)
    config_manager.set("channels", cfg)
    return {"message": f"channel '{key}' 已停止并移除"}


BUILTIN_AGENTS = {"main"}


# ── Agent 管理端点 ─────────────────────────────────────────────────────────────

@app.get("/agents")
async def list_agents():
    """返回所有已配置的 agent 及其配置。"""
    agents_cfg: dict = config_manager.get("agents", {})
    return {
        "agents": [
            _build_agent_entry(key, cfg)
            for key, cfg in agents_cfg.items()
        ]
    }


@app.get("/agents/{name}")
async def get_agent_detail(name: str):
    """返回单个 agent 的详情。"""
    cfg = _require_agent(name)
    return _build_agent_entry(name, cfg)


@app.post("/agents")
async def add_agent(request: AddAgentRequest):
    """创建新 agent：复制 template 并写入 config。"""
    import shutil
    if config_manager.get(f"agents.{request.name}"):
        raise HTTPException(status_code=400, detail=f"agent '{request.name}' 已存在")

    _validate_agent_provider(request.provider)

    template_dir = TEMPLATE_DIR
    agent_dir = WORKSPACE_DIR / "agents" / request.name
    agent_dir.mkdir(parents=True, exist_ok=True)

    for src in template_dir.rglob("*"):
        if src.suffix in (".py", ".pyc") or "__pycache__" in src.parts:
            continue
        dst = agent_dir / src.relative_to(template_dir)
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(src, dst)

    config_manager.set(f"agents.{request.name}", {
        "name": request.display_name,
        "description": request.description,
        "provider": request.provider,
        "emoji": request.emoji,
    })
    return {"message": f"agent '{request.name}' 已创建"}


@app.patch("/agents/{name}")
async def update_agent(name: str, request: UpdateAgentRequest):
    """部分更新 agent 配置。"""
    existing_cfg = _require_agent(name)
    merged_cfg = dict(existing_cfg)

    if request.display_name is not None:
        merged_cfg["name"] = request.display_name
    if request.description is not None:
        merged_cfg["description"] = request.description
    if request.provider is not None:
        _validate_agent_provider(request.provider)
        merged_cfg["provider"] = request.provider
    if request.emoji is not None:
        merged_cfg["emoji"] = request.emoji

    config_manager.set(f"agents.{name}", merged_cfg)
    return {"message": f"agent '{name}' 已更新"}


@app.delete("/agents/{name}")
async def delete_agent(name: str):
    """删除 agent（移除 config 并删除 workspace 目录）。内置 agent 不可删除。"""
    import shutil
    if name in BUILTIN_AGENTS:
        raise HTTPException(status_code=400, detail=f"agent '{name}' 为内置 agent，不可删除")
    if not config_manager.get(f"agents.{name}"):
        raise HTTPException(status_code=404, detail=f"agent '{name}' 不存在")

    used_by = _get_agent_usages(name)
    if used_by:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"agent '{name}' 正在被 channel 引用，无法删除",
                "used_by_channels": used_by,
            },
        )

    agent_dir = WORKSPACE_DIR / "agents" / name
    if agent_dir.exists():
        shutil.rmtree(agent_dir)

    agents_cfg = config_manager.get("agents", {})
    agents_cfg.pop(name, None)
    config_manager.set("agents", agents_cfg)
    return {"message": f"agent '{name}' 已删除"}


# ── Agent Workspace Files ──────────────────────────────────────────────────────

EDITABLE_AGENT_FILES = {"AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "BOOTSTRAP.md"}


@app.get("/agents/{name}/files")
async def list_agent_files(name: str):
    """列出 agent workspace 下可编辑的 md 文件。"""
    _require_agent(name)
    agent_dir = WORKSPACE_DIR / "agents" / name
    if not agent_dir.exists():
        return {"files": []}
    files = [
        f.name for f in sorted(agent_dir.iterdir())
        if f.is_file() and f.name in EDITABLE_AGENT_FILES
    ]
    return {"files": files}


@app.get("/agents/{name}/files/{filename}")
async def read_agent_file(name: str, filename: str):
    """读取 agent workspace 下的单个 md 文件内容。"""
    _require_agent(name)
    if filename not in EDITABLE_AGENT_FILES:
        raise HTTPException(status_code=400, detail=f"不可读取的文件: {filename}")
    file_path = WORKSPACE_DIR / "agents" / name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"文件 '{filename}' 不存在")
    content = file_path.read_text(encoding="utf-8")
    return {"filename": filename, "content": content}


@app.put("/agents/{name}/files/{filename}")
async def write_agent_file(name: str, filename: str, body: WriteFileRequest):
    """写入 agent workspace 下的单个 md 文件。"""
    _require_agent(name)
    if filename not in EDITABLE_AGENT_FILES:
        raise HTTPException(status_code=400, detail=f"不可编辑的文件: {filename}")
    file_path = WORKSPACE_DIR / "agents" / name / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(body.content, encoding="utf-8")
    return {"message": f"文件 '{filename}' 已保存"}


# ── Skills 管理端点 ────────────────────────────────────────────────────────────


def _build_skill_entry(
    name: str, loader: SkillsLoader, source: str, agent_name: str | None = None,
) -> dict:
    """Build a skill info dict for API responses."""
    meta = loader.get_skill_metadata(name) or {}
    aurogen_meta = loader._parse_aurogen_metadata(meta.get("metadata", ""))
    available = loader._check_requirements(aurogen_meta)
    missing = loader._get_missing_requirements(aurogen_meta) if not available else None

    return SkillInfo(
        name=name,
        description=meta.get("description", name),
        source=source,
        agent_name=agent_name,
        available=available,
        missing_requirements=missing,
        metadata=aurogen_meta or None,
    ).model_dump()


@app.get("/skills")
async def list_skills(
    scope: str | None = None,
    agent_name: str = "main",
):
    """
    列出技能。
    - scope 为空：返回 builtin + 指定 agent 的 workspace skills
    - scope=builtin：仅返回公共技能
    - scope=workspace：仅返回指定 agent 的技能
    """
    results: list[dict] = []

    if scope in (None, "builtin"):
        builtin_dir = resolve_skills_dir("builtin")
        if builtin_dir.exists():
            loader = get_skills_loader(agent_name)
            for skill_dir in sorted(builtin_dir.iterdir()):
                if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                    results.append(
                        _build_skill_entry(skill_dir.name, loader, source="builtin")
                    )

    if scope in (None, "workspace"):
        ws_dir = resolve_skills_dir("workspace", agent_name)
        if ws_dir.exists():
            loader = get_skills_loader(agent_name)
            for skill_dir in sorted(ws_dir.iterdir()):
                if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                    if not any(s["name"] == skill_dir.name for s in results):
                        results.append(
                            _build_skill_entry(
                                skill_dir.name, loader,
                                source="workspace", agent_name=agent_name,
                            )
                        )

    return {"skills": results}


@app.get("/skills/{name}")
async def get_skill_detail(
    name: str,
    scope: str | None = None,
    agent_name: str = "main",
):
    """返回单个技能的详情（含 SKILL.md 内容）。"""
    loader = get_skills_loader(agent_name)

    if scope == "workspace":
        skill_file = resolve_skills_dir("workspace", agent_name) / name / "SKILL.md"
    elif scope == "builtin":
        skill_file = resolve_skills_dir("builtin") / name / "SKILL.md"
    else:
        ws_file = resolve_skills_dir("workspace", agent_name) / name / "SKILL.md"
        bi_file = resolve_skills_dir("builtin") / name / "SKILL.md"
        skill_file = ws_file if ws_file.exists() else bi_file

    if not skill_file.exists():
        raise HTTPException(status_code=404, detail=f"技能 '{name}' 不存在")

    source = "workspace" if "agents" in str(skill_file) else "builtin"
    content = skill_file.read_text(encoding="utf-8")
    meta = loader.get_skill_metadata(name) or {}
    aurogen_meta = loader._parse_aurogen_metadata(meta.get("metadata", ""))
    available = loader._check_requirements(aurogen_meta)
    missing = loader._get_missing_requirements(aurogen_meta) if not available else None

    return SkillDetailResponse(
        name=name,
        description=meta.get("description", name),
        source=source,
        agent_name=agent_name if source == "workspace" else None,
        available=available,
        missing_requirements=missing,
        metadata=aurogen_meta or None,
        content=content,
    ).model_dump()


@app.post("/skills/upload")
async def upload_skill(
    file: UploadFile = File(...),
    scope: str = Form(...),
    agent_name: str = Form("main"),
):
    """
    上传 zip 技能包并解压到目标目录。
    scope: "builtin" | "workspace"
    agent_name: 当 scope=workspace 时指定目标 agent
    """
    if scope not in ("builtin", "workspace"):
        raise HTTPException(status_code=400, detail="scope 必须为 'builtin' 或 'workspace'")

    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 .zip 格式的文件")

    MAX_SIZE = 50 * 1024 * 1024  # 50 MB
    zip_bytes = await file.read()
    if len(zip_bytes) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过 50 MB 限制")

    target_dir = resolve_skills_dir(scope, agent_name)

    try:
        skill_name = SkillsLoader.install_skill_from_zip(
            zip_bytes, target_dir, filename=file.filename or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "message": f"技能 '{skill_name}' 已安装",
        "name": skill_name,
        "scope": scope,
        "agent_name": agent_name if scope == "workspace" else None,
        "path": str(target_dir / skill_name),
    }


@app.delete("/skills/{name}")
async def delete_skill(
    name: str,
    scope: str = "builtin",
    agent_name: str = "main",
):
    """删除指定技能文件夹。"""
    if scope not in ("builtin", "workspace"):
        raise HTTPException(status_code=400, detail="scope 必须为 'builtin' 或 'workspace'")

    target_dir = resolve_skills_dir(scope, agent_name)

    try:
        SkillsLoader.delete_skill(name, target_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "message": f"技能 '{name}' 已删除",
        "scope": scope,
        "agent_name": agent_name if scope == "workspace" else None,
    }


@app.post("/channels/reload")
async def reload_channels():
    """
    对比 config 与运行中的 channel，增量更新：
    - config 中新增的 channel → start()
    - config 中已移除的 channel → stop()
    - 两边都有的 → 保持不变（不重启，避免断连）
    """
    result = await get_channel_manager().reload()
    return result


# ── 消息端点 ──────────────────────────────────────────────────────────────────


@app.post("/chat/session")
async def create_chat_session(request: CreateChatSessionRequest):
    """创建新的 web chat session，返回 session_id 与当前绑定 agent。"""
    if request.channel != "web":
        raise HTTPException(status_code=400, detail="当前仅支持为 web channel 创建 chat session")

    chat_id = request.chat_id or uuid4().hex[:8]
    session_id = f"{request.channel}@{chat_id}"
    agent_name = config_manager.get(f"channels.{request.channel}.agent_name", "main")

    # 在创建会话时立即落盘空 session，避免刷新前端后列表丢失未发首条消息的会话。
    Session(session_id)

    return {
        "session_id": session_id,
        "channel": request.channel,
        "chat_id": chat_id,
        "agent_name": agent_name,
    }


@app.get("/chat/events/schema")
async def get_chat_events_schema():
    """返回 web chat SSE 事件协议说明。"""
    return {
        "transport": "sse",
        "endpoint": "/chat",
        "events": [
            {
                "event": EventType.THINKING.value,
                "description": "LLM 思考过程",
                "data_schema": {"content": "string"},
            },
            {
                "event": EventType.TOOL_CALL.value,
                "description": "工具调用开始",
                "data_schema": {"tool_name": "string", "args": "object"},
            },
            {
                "event": EventType.TOOL_RESULT.value,
                "description": "工具调用结果",
                "data_schema": {"tool_name": "string", "result": "string"},
            },
            {
                "event": EventType.FINAL.value,
                "description": "最终回复",
                "data_schema": {"content": "string"},
            },
        ],
    }


@app.get("/system/status")
async def get_system_status():
    """返回前端首页和状态栏可直接消费的系统状态。"""
    loaded_mcp_tools = []
    if agent_loop:
        loaded_mcp_tools = [
            name for name in getattr(agent_loop.tools, "tool_names", [])
            if name.startswith("mcp_")
        ]
    hb_cfg = config_manager.get("heartbeat", {})
    cron_cfg = config_manager.get("cron", {})
    return {
        "app": "ok",
        "agent_loop_running": bool(agent_loop and agent_loop._running),
        "heartbeat": {
            "running": bool(heartbeat_service and heartbeat_service._running),
            "agent_name": hb_cfg.get("agent_name", "heartbeat"),
            "interval_s": hb_cfg.get("interval_s", 1800),
            "enabled": hb_cfg.get("enabled", True),
        },
        "cron": {
            "running": bool(agent_loop and agent_loop.cron_service._running),
            "agent_name": cron_cfg.get("agent_name", "main"),
            "enabled": cron_cfg.get("enabled", True),
        },
        "channels": get_channel_manager().status()["channels"],
        "mcp": {
            "configured": len(config_manager.get("mcp", {})),
            "loaded_count": len(loaded_mcp_tools),
            "loaded_tools": loaded_mcp_tools,
        },
    }


@app.get("/resources/summary")
async def get_resources_summary():
    """返回 Web 控制台首页可用的资源统计摘要。"""
    return {
        "agents_count": len(config_manager.get("agents", {})),
        "channels_count": len(config_manager.get("channels", {})),
        "providers_count": len(config_manager.get("providers", {})),
        "sessions_count": _count_total_sessions(),
    }


@app.get("/sessions")
async def list_sessions_v2(
    group_by: str = "channel",
    channel: str | None = None,
    agent_name: str | None = None,
) -> dict:
    """
    列出所有 sessions，支持按 channel 或 agent 分组。
    - group_by: "channel" | "agent"
    - channel: 可选，按 channel 过滤
    - agent_name: 可选，按 agent 过滤
    """
    if group_by not in ("channel", "agent"):
        raise HTTPException(status_code=400, detail="group_by 必须为 'channel' 或 'agent'")

    agents_dir = WORKSPACE_DIR / "agents"
    groups: dict[str, list[dict]] = {}

    if agents_dir.exists():
        for agent_dir in sorted(agents_dir.iterdir()):
            if not agent_dir.is_dir():
                continue
            current_agent = agent_dir.name
            if agent_name and current_agent != agent_name:
                continue
            sessions_dir = agent_dir / "sessions"
            if not sessions_dir.exists():
                continue
            for session_file in sorted(sessions_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
                sid = session_file.stem
                if "@" not in sid:
                    continue
                sid_channel = sid.split("@", 1)[0]
                if channel and sid_channel != channel:
                    continue
                info = _build_session_info(sid, session_file, current_agent)
                group_key = sid_channel if group_by == "channel" else current_agent
                groups.setdefault(group_key, []).append(info.model_dump())

    return {
        "group_by": group_by,
        "groups": [
            {"key": key, "sessions": sessions}
            for key, sessions in groups.items()
        ],
    }


@app.get("/list-sessions")
async def list_sessions(channel: str) -> dict:
    agent_name = config_manager.get(f"channels.{channel}.agent_name", "main")
    sessions_dir = WORKSPACE_DIR / "agents" / agent_name / "sessions"
    if not sessions_dir.exists():
        return {"agent_name": agent_name, "sessions": []}
    sessions: list[SessionInfo] = []
    for f in sorted(sessions_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        session_id = f.stem
        parts = session_id.split("@", 1)
        if len(parts) != 2 or parts[0] != channel:
            continue
        sessions.append(_build_session_info(session_id, f, agent_name))
    return {"agent_name": agent_name, "sessions": [s.model_dump() for s in sessions]}


@app.get("/get-session")
async def get_session(channel: str, session_id: str) -> dict:
    """根据 channel 和 session_id 读取聊天记录。"""
    agent_name, session_file = _get_session_file(channel, session_id)
    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")
    data = json.loads(session_file.read_text(encoding="utf-8"))
    messages = data.get("messages", data) if isinstance(data, dict) else data
    return {
        "agent_name": agent_name,
        "session_id": session_id,
        "messages": messages,
    }


@app.delete("/delete-session")
async def delete_session(channel: str, session_id: str) -> dict:
    """根据 channel 和 session_id 删除会话文件。"""
    agent_name, session_file = _get_session_file(channel, session_id)
    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")

    session_file.unlink()
    return {
        "message": f"Session '{session_id}' 已删除",
        "agent_name": agent_name,
        "session_id": session_id,
    }


@app.post("/send-message")
async def send_message(request: SendMessageRequest):

    msg = InboundMessage(
        session_id=request.session_id,
        content=request.message,
        metadata=request.metadata or {}
    )
    await get_inbound_queue().put(msg)
    return {"message": "Message sent successfully"}


@app.post("/chat")
async def chat(request: SendMessageRequest):
    """SSE 端点：发送消息并通过流式返回多轮反馈（仅适用于 web channel）。"""
    session_id = request.session_id

    web_channel = get_channel_manager().get("web")
    if not isinstance(web_channel, WebChannel):
        raise HTTPException(status_code=503, detail="web channel 未启动")

    queue = await web_channel.subscribe(session_id)
    await web_channel.receive(
        session_id=session_id,
        content=request.message,
        metadata=request.metadata,
    )

    async def event_stream():
        try:
            async for sse_str in web_channel.event_stream(queue):
                yield sse_str
        finally:
            await web_channel.unsubscribe(session_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# 挂载前端静态文件（仅当 dist 目录存在时生效，不影响本地开发）
_dist_dir = Path(__file__).resolve().parent.parent.parent / "aurogen_web" / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="static")
