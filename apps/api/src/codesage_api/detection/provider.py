"""Tool-neutral boundary for optional source-code detectors."""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Protocol, cast

from codesage_api.config import get_settings
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.logging import get_logger

logger = get_logger(__name__)


class DetectorStatus(str, Enum):
    OK = "ok"
    SKIPPED = "skipped"
    DEGRADED = "degraded"


@dataclass(frozen=True, slots=True)
class ScanContext:
    attempt_id: str | None = None
    disabled_rule_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class DetectorResult:
    status: DetectorStatus
    findings: list[DetectedFinding] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)
    metadata: dict[str, object] = field(default_factory=dict)


class Detector(Protocol):
    def __call__(
        self, repository_path: Path, scan_context: ScanContext | None = None
    ) -> DetectorResult: ...


def load_detector(provider: str) -> Detector:
    """Load ``package.module:callable`` and validate the provider boundary."""
    module_name, separator, attribute = provider.partition(":")
    if not separator or not module_name or not attribute:
        raise ValueError(
            "CODESAGE_DETECTOR_PROVIDER must use package.module:callable syntax."
        )
    candidate = getattr(importlib.import_module(module_name), attribute)
    if not callable(candidate):
        raise TypeError(f"Configured detector provider is not callable: {provider}")
    return cast(Detector, candidate)


def run_optional_detector(
    repository_path: Path,
    scan_context: ScanContext | None = None,
    *,
    provider: str | None = None,
) -> DetectorResult:
    """Run the configured detector without making it a scan dependency."""
    selected = provider if provider is not None else get_settings().detector_provider
    if not selected:
        return DetectorResult(
            DetectorStatus.SKIPPED,
            metadata={"detector_provider": None, "status": "skipped"},
        )
    try:
        result = load_detector(selected)(repository_path, scan_context)
        if not isinstance(result, DetectorResult):
            raise TypeError("Detector provider returned an invalid result.")
        return result
    except Exception as exc:
        logger.exception(
            "Optional detector degraded",
            extra={"detector_provider": selected},
        )
        return DetectorResult(
            DetectorStatus.DEGRADED,
            diagnostics=[Diagnostic("provider_failed", str(exc))],
            metadata={
                "detector_provider": selected,
                "status": "degraded",
                "findings": 0,
            },
        )
