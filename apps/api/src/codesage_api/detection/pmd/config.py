from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from codesage_api.config import Settings, get_settings


@dataclass(frozen=True, slots=True)
class PMDConfig:
    enabled: bool
    executable: Path
    timeout_seconds: float
    ruleset: Path
    mapping: Path | None = None
    java_version: str | None = None
    aux_classpath: tuple[Path, ...] = ()


def load_config(settings: Settings | None = None) -> PMDConfig:
    configured = settings or get_settings()
    if configured.pmd_timeout_seconds <= 0:
        raise ValueError("CODESAGE_PMD_TIMEOUT_SECONDS must be greater than zero.")
    package_path = Path(__file__).parent
    return PMDConfig(
        enabled=configured.pmd_enabled,
        executable=Path(configured.pmd_bin),
        timeout_seconds=configured.pmd_timeout_seconds,
        ruleset=package_path / "rulesets" / "codesage.xml",
        mapping=package_path / "rule_mapping.yaml",
    )
