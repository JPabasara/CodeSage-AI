from __future__ import annotations

from dataclasses import dataclass

from codesage_api.detection.provider import (
    DetectorResult,
    DetectorStatus,
    Diagnostic,
    ScanContext,
)

__all__ = [
    "DetectorResult",
    "DetectorStatus",
    "Diagnostic",
    "PMDViolation",
    "ScanContext",
]


@dataclass(frozen=True, slots=True)
class PMDViolation:
    rule: str
    ruleset: str
    priority: int
    message: str
    file_path: str
    begin_line: int
    end_line: int
    begin_column: int
    end_column: int
    package_name: str | None = None
    class_name: str | None = None
    method_name: str | None = None
    variable_name: str | None = None
