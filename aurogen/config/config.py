import json
import shutil
from pathlib import Path
from typing import Dict, Optional, Any
from threading import Lock

from config.schema import AppConfig, AgentConfig, ProviderConfig

BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR / ".workspace"
TEMPLATE_DIR = BASE_DIR / "template"


class ConfigManager:
    """配置管理器 - 支持动态修改和持久化"""

    _instance = None
    _lock = Lock()

    def __new__(cls, *args, **kwargs):
        """单例模式，确保全局只有一个配置管理器"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config_path: str | Path = WORKSPACE_DIR / "config.json"):
        if hasattr(self, '_initialized') and self._initialized:
            return
        self.config_path = Path(config_path)
        self._config: Optional[AppConfig] = None
        self._file_lock = Lock()
        self._load()
        self._initialized = True

    def _load(self) -> None:
        """从文件加载配置"""
        with self._file_lock:
            if not self.config_path.exists():
                example_path = self.config_path.parent / "config_example.json"
                if not example_path.exists():
                    example_path = BASE_DIR / "config_example.json"
                if example_path.exists():
                    shutil.copy2(example_path, self.config_path)
                    from loguru import logger
                    logger.info("[Config] config.json 不存在，已从 config_example.json 自动复制")
            if self.config_path.exists():
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                migrated_model, data = self._migrate_model_settings(data)
                migrated_heartbeat, data = self._migrate_heartbeat_settings(data)
                migrated_bootstrap, data = self._migrate_bootstrap_settings(data)
                migrated = migrated_model or migrated_heartbeat or migrated_bootstrap
                self._config = AppConfig(**data)
                if migrated:
                    with open(self.config_path, "w", encoding="utf-8") as f:
                        json.dump(self._config.model_dump(), f, indent=4, ensure_ascii=False)
            else:
                self._config = AppConfig()

    @staticmethod
    def _migrate_model_settings(data: dict) -> tuple[bool, dict]:
        """Migrate old config format where model_settings lived inside agents.

        Returns (migrated, data) where migrated indicates if changes were made.
        """
        agents = data.get("agents", {})
        providers = data.get("providers", {})
        needs_migration = any(
            isinstance(cfg, dict) and "model_settings" in cfg
            for cfg in agents.values()
        )
        if not needs_migration:
            return False, data

        from loguru import logger
        logger.info("[Config] 检测到旧格式 model_settings，开始自动迁移")

        provider_model_map: dict[str, tuple] = {}
        for agent_key, agent_cfg in agents.items():
            ms = agent_cfg.get("model_settings")
            if not isinstance(ms, dict):
                continue
            provider_key = ms.get("provider", "")
            model = ms.get("model", "")
            memory_window = ms.get("memory_window", 100)
            thinking = ms.get("thinking", "none")
            fingerprint = (provider_key, model, memory_window, thinking)

            if provider_key in providers:
                existing_fp = provider_model_map.get(provider_key)
                if existing_fp is None:
                    providers[provider_key].setdefault("model", model)
                    providers[provider_key].setdefault("memory_window", memory_window)
                    providers[provider_key].setdefault("thinking", thinking)
                    provider_model_map[provider_key] = fingerprint
                    agent_cfg.pop("model_settings", None)
                    agent_cfg["provider"] = provider_key
                elif existing_fp == fingerprint:
                    agent_cfg.pop("model_settings", None)
                    agent_cfg["provider"] = provider_key
                else:
                    new_key = f"{provider_key}_{agent_key}"
                    providers[new_key] = {
                        **providers[provider_key],
                        "model": model,
                        "memory_window": memory_window,
                        "thinking": thinking,
                    }
                    agent_cfg.pop("model_settings", None)
                    agent_cfg["provider"] = new_key
                    logger.info(f"[Config] agent '{agent_key}' 使用不同 model 设置，创建新 provider '{new_key}'")
            else:
                agent_cfg.pop("model_settings", None)
                agent_cfg["provider"] = provider_key

        data["agents"] = agents
        data["providers"] = providers
        logger.info("[Config] model_settings 迁移完成")
        return True, data

    @staticmethod
    def _migrate_heartbeat_settings(data: dict) -> tuple[bool, dict]:
        """Migrate single heartbeat config into per-agent heartbeat configs."""
        heartbeat = data.get("heartbeat")
        agents = data.get("agents", {})
        if not isinstance(heartbeat, dict):
            return False, data

        is_legacy_shape = any(key in heartbeat for key in ("agent_name", "interval_s", "enabled"))
        if not is_legacy_shape:
            return False, data

        default_cfg = {
            "interval_s": 1800,
            "enabled": True,
        }
        target_agent = heartbeat.get("agent_name")
        if not isinstance(target_agent, str) or target_agent not in agents:
            target_agent = "main" if "main" in agents else next(iter(agents), "main")

        migrated_heartbeat = {
            agent_key: dict(default_cfg)
            for agent_key in agents
        }
        migrated_heartbeat[target_agent] = {
            "interval_s": heartbeat.get("interval_s", default_cfg["interval_s"]),
            "enabled": heartbeat.get("enabled", default_cfg["enabled"]),
        }
        data["heartbeat"] = migrated_heartbeat
        return True, data

    @staticmethod
    def _migrate_bootstrap_settings(data: dict) -> tuple[bool, dict]:
        """Ensure every agent has an explicit bootstrap completion flag."""
        agents = data.get("agents", {})
        if not isinstance(agents, dict):
            return False, data

        migrated = False
        for agent_key, agent_cfg in agents.items():
            if not isinstance(agent_cfg, dict) or "bootstrap_completed" in agent_cfg:
                continue

            bootstrap_file = WORKSPACE_DIR / "agents" / agent_key / "BOOTSTRAP.md"
            bootstrap_completed = False
            if not bootstrap_file.exists():
                bootstrap_completed = True
            else:
                try:
                    content = bootstrap_file.read_text(encoding="utf-8").strip()
                    bootstrap_completed = content.startswith("# Bootstrap Complete")
                except Exception:
                    bootstrap_completed = False

            agent_cfg["bootstrap_completed"] = bootstrap_completed
            migrated = True

        data["agents"] = agents
        return migrated, data

    def _save(self) -> None:
        """保存配置到文件"""
        with self._file_lock:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self._config.model_dump(), f, indent=4, ensure_ascii=False)

    @property
    def config(self) -> AppConfig:
        """获取当前配置"""
        return self._config

    def get_full_config(self) -> Dict[str, Any]:
        """获取完整配置字典"""
        return self._config.model_dump()

    def reload(self) -> None:
        """重新加载配置文件"""
        self._load()

    def get(self, path: str, default: Any = None) -> Any:
        """
        获取配置值，支持路径访问
        例如: get("agents.main.model") -> "gpt-4o-mini"
        """
        keys = path.split(".")
        value = self._config.model_dump()
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value

    def set(self, path: str, value: Any) -> bool:
        """
        设置配置值并持久化
        例如: set("agents.main.model", "gpt-4")
        """
        keys = path.split(".")
        data = self._config.model_dump()

        # 导航到目标位置
        target = data
        for key in keys[:-1]:
            if key not in target:
                target[key] = {}
            target = target[key]

        # 设置值
        target[keys[-1]] = value

        # 重新构建配置对象并保存
        self._config = AppConfig(**data)
        self._save()
        return True

# 全局配置管理器实例
config_manager = ConfigManager()
