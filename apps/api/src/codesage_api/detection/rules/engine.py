from __future__ import annotations

from codesage_api.detection.rules.registry import RuleDefinition
from codesage_api.extractors.ck_metrics import FileMetrics


def detect(files: list[FileMetrics], rules: list[RuleDefinition]) -> list[dict]:
    raise NotImplementedError
