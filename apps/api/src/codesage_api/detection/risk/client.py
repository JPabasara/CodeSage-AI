from __future__ import annotations

from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


def predict(
    files: list[FileMetrics], process: dict[str, FileProcessMetrics]
) -> dict[str, float]:
    raise NotImplementedError
