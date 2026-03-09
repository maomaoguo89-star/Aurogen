"""Skills loader for agent capabilities."""

import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

# Default builtin skills directory (relative to this file)
BUILTIN_SKILLS_DIR = Path(__file__).parent.parent / "skills"
WORKSPACE_DIR = Path(__file__).parent.parent / ".workspace"


class SkillsLoader:
    """
    Loader for agent skills.

    Skills are markdown files (SKILL.md) that teach the agent how to use
    specific tools or perform certain tasks.
    """

    def __init__(self, workspace: Path, builtin_skills_dir: Path | None = None):
        self.workspace = workspace
        self.workspace_skills = workspace / "skills"
        self.builtin_skills = builtin_skills_dir or BUILTIN_SKILLS_DIR

    def list_skills(self, filter_unavailable: bool = True) -> list[dict[str, str]]:
        """
        List all available skills.

        Args:
            filter_unavailable: If True, filter out skills with unmet requirements.

        Returns:
            List of skill info dicts with 'name', 'path', 'source'.
        """
        skills = []

        # Workspace skills (highest priority)
        if self.workspace_skills.exists():
            for skill_dir in self.workspace_skills.iterdir():
                if skill_dir.is_dir():
                    skill_file = skill_dir / "SKILL.md"
                    if skill_file.exists():
                        skills.append({"name": skill_dir.name, "path": str(skill_file), "source": "workspace"})

        # Built-in skills
        if self.builtin_skills and self.builtin_skills.exists():
            for skill_dir in self.builtin_skills.iterdir():
                if skill_dir.is_dir():
                    skill_file = skill_dir / "SKILL.md"
                    if skill_file.exists() and not any(s["name"] == skill_dir.name for s in skills):
                        skills.append({"name": skill_dir.name, "path": str(skill_file), "source": "builtin"})

        # Filter by requirements
        if filter_unavailable:
            return [s for s in skills if self._check_requirements(self._get_skill_meta(s["name"]))]
        return skills

    def load_skill(self, name: str) -> str | None:
        """
        Load a skill by name.

        Args:
            name: Skill name (directory name).

        Returns:
            Skill content or None if not found.
        """
        # Check workspace first
        workspace_skill = self.workspace_skills / name / "SKILL.md"
        if workspace_skill.exists():
            return workspace_skill.read_text(encoding="utf-8")

        # Check built-in
        if self.builtin_skills:
            builtin_skill = self.builtin_skills / name / "SKILL.md"
            if builtin_skill.exists():
                return builtin_skill.read_text(encoding="utf-8")

        return None

    def load_skills_for_context(self, skill_names: list[str]) -> str:
        """
        Load specific skills for inclusion in agent context.

        Args:
            skill_names: List of skill names to load.

        Returns:
            Formatted skills content.
        """
        parts = []
        for name in skill_names:
            content = self.load_skill(name)
            if content:
                content = self._strip_frontmatter(content)
                parts.append(f"### Skill: {name}\n\n{content}")

        return "\n\n---\n\n".join(parts) if parts else ""

    def build_skills_summary(self) -> str:
        """
        Build a summary of all skills (name, description, path, availability).

        This is used for progressive loading - the agent can read the full
        skill content using read_file when needed.

        Returns:
            XML-formatted skills summary.
        """
        all_skills = self.list_skills(filter_unavailable=False)
        if not all_skills:
            return ""

        def escape_xml(s: str) -> str:
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        lines = ["<skills>"]
        for s in all_skills:
            name = escape_xml(s["name"])
            path = s["path"]
            desc = escape_xml(self._get_skill_description(s["name"]))
            skill_meta = self._get_skill_meta(s["name"])
            available = self._check_requirements(skill_meta)

            lines.append(f"  <skill available=\"{str(available).lower()}\">")
            lines.append(f"    <name>{name}</name>")
            lines.append(f"    <description>{desc}</description>")
            lines.append(f"    <location>{path}</location>")

            # Show missing requirements for unavailable skills
            if not available:
                missing = self._get_missing_requirements(skill_meta)
                if missing:
                    lines.append(f"    <requires>{escape_xml(missing)}</requires>")

            lines.append("  </skill>")
        lines.append("</skills>")

        return "\n".join(lines)

    def _get_missing_requirements(self, skill_meta: dict) -> str:
        """Get a description of missing requirements."""
        missing = []
        requires = skill_meta.get("requires", {})
        for b in requires.get("bins", []):
            if not shutil.which(b):
                missing.append(f"CLI: {b}")
        for env in requires.get("env", []):
            if not os.environ.get(env):
                missing.append(f"ENV: {env}")
        return ", ".join(missing)

    def _get_skill_description(self, name: str) -> str:
        """Get the description of a skill from its frontmatter."""
        meta = self.get_skill_metadata(name)
        if meta and meta.get("description"):
            return meta["description"]
        return name  # Fallback to skill name

    def _strip_frontmatter(self, content: str) -> str:
        """Remove YAML frontmatter from markdown content."""
        if content.startswith("---"):
            match = re.match(r"^---\n.*?\n---\n", content, re.DOTALL)
            if match:
                return content[match.end():].strip()
        return content

    def _parse_aurogen_metadata(self, raw: str) -> dict:
        """Parse skill metadata JSON from frontmatter (supports aurogen and openclaw keys)."""
        try:
            data = json.loads(raw)
            return data.get("aurogen", data.get("openclaw", {})) if isinstance(data, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def _check_requirements(self, skill_meta: dict) -> bool:
        """Check if skill requirements are met (bins, env vars)."""
        requires = skill_meta.get("requires", {})
        for b in requires.get("bins", []):
            if not shutil.which(b):
                return False
        for env in requires.get("env", []):
            if not os.environ.get(env):
                return False
        return True

    def _get_skill_meta(self, name: str) -> dict:
        """Get aurogen metadata for a skill (cached in frontmatter)."""
        meta = self.get_skill_metadata(name) or {}
        return self._parse_aurogen_metadata(meta.get("metadata", ""))

    def get_always_skills(self) -> list[str]:
        """Get skills marked as always=true that meet requirements."""
        result = []
        for s in self.list_skills(filter_unavailable=True):
            meta = self.get_skill_metadata(s["name"]) or {}
            skill_meta = self._parse_aurogen_metadata(meta.get("metadata", ""))
            if skill_meta.get("always") or meta.get("always"):
                result.append(s["name"])
        return result

    def get_skill_metadata(self, name: str) -> dict | None:
        """
        Get metadata from a skill's frontmatter.

        Args:
            name: Skill name.

        Returns:
            Metadata dict or None.
        """
        content = self.load_skill(name)
        if not content:
            return None

        if content.startswith("---"):
            match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
            if match:
                # Simple YAML parsing
                metadata = {}
                for line in match.group(1).split("\n"):
                    if ":" in line:
                        key, value = line.split(":", 1)
                        metadata[key.strip()] = value.strip().strip('"\'')
                return metadata

        return None

    # ── Skill management (install / delete) ────────────────────────────────

    @staticmethod
    def install_skill_from_zip(
        zip_bytes: bytes, target_dir: Path, filename: str = "",
    ) -> str:
        """
        Extract a skill zip into *target_dir*.

        The zip may contain either:
          a) SKILL.md at the archive root  -> use *filename* (sans .zip) as folder name
          b) A single sub-directory that contains SKILL.md

        Args:
            zip_bytes: Raw bytes of the uploaded zip.
            target_dir: The skills directory to install into.
            filename: Original upload filename, used to derive the skill name
                      when SKILL.md sits at the archive root.

        Returns the skill name (directory name) that was installed.
        Raises ValueError on validation failure.
        """
        target_dir.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            zip_path = tmp / "upload.zip"
            zip_path.write_bytes(zip_bytes)

            if not zipfile.is_zipfile(zip_path):
                raise ValueError("上传的文件不是有效的 zip 压缩包")

            extract_dir = tmp / "extracted"
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.namelist():
                    if ".." in member or member.startswith("/"):
                        raise ValueError(f"zip 中包含不安全的路径: {member}")
                zf.extractall(extract_dir)

            skill_root, is_root_level = SkillsLoader._locate_skill_root(extract_dir)
            if skill_root is None:
                raise ValueError("zip 中未找到 SKILL.md，请确保技能包格式正确")

            if is_root_level:
                stem = Path(filename).stem if filename else ""
                if not stem:
                    raise ValueError("zip 根目录直接包含 SKILL.md，但无法从文件名推断技能名称")
                skill_name = stem
            else:
                skill_name = skill_root.name

            dest = target_dir / skill_name
            if dest.exists():
                raise ValueError(f"技能 '{skill_name}' 已存在于目标目录中")

            shutil.copytree(str(skill_root), str(dest))
            return skill_name

    @staticmethod
    def delete_skill(name: str, target_dir: Path) -> None:
        """
        Delete a skill folder from *target_dir*.
        Raises FileNotFoundError if the skill does not exist.
        """
        skill_dir = target_dir / name
        if not skill_dir.exists() or not skill_dir.is_dir():
            raise FileNotFoundError(f"技能 '{name}' 在目标目录中不存在")
        shutil.rmtree(str(skill_dir))

    @staticmethod
    def _locate_skill_root(extract_dir: Path) -> tuple[Path | None, bool]:
        """
        Find the directory containing SKILL.md inside *extract_dir*.

        Returns:
            (skill_root, is_root_level)
            - skill_root: Path to the dir with SKILL.md, or None.
            - is_root_level: True when SKILL.md was directly in extract_dir
              (no wrapping sub-folder), meaning we need to derive the name
              from the original zip filename.
        """
        for child in extract_dir.iterdir():
            if child.is_dir() and (child / "SKILL.md").exists():
                return child, False

        if (extract_dir / "SKILL.md").exists():
            return extract_dir, True

        return None, False


def resolve_skills_dir(scope: str, agent_name: str | None = None) -> Path:
    """
    Resolve the target skills directory for a given scope.

    scope="builtin"   -> project-level skills/
    scope="workspace" -> .workspace/agents/{agent_name}/skills/
    """
    if scope == "builtin":
        return BUILTIN_SKILLS_DIR
    if scope == "workspace":
        name = agent_name or "main"
        return WORKSPACE_DIR / "agents" / name / "skills"
    raise ValueError(f"未知的 scope: {scope!r}，应为 'builtin' 或 'workspace'")


def get_skills_loader(agent_name: str = "main") -> SkillsLoader:
    """Factory: create a SkillsLoader for the given agent."""
    agent_workspace = WORKSPACE_DIR / "agents" / agent_name
    return SkillsLoader(workspace=agent_workspace)
