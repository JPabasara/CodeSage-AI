"""ML-2 client: file metrics in, per-file risk score out (SRS FR-10).

Calls the /risk endpoint on the ML service. Degrades gracefully by raising
MLServiceUnavailable when the container is down or returns a malformed response.
"""

from __future__ import annotations

import httpx

from dataclasses import dataclass

from codesage_api.config import get_settings
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


@dataclass(frozen=True, slots=True)
class RiskClientResult:
    scores: dict[str, float]
    model_version: str


def predict(
    files: list[FileMetrics], process: dict[str, FileProcessMetrics]
) -> RiskClientResult:
    """Batch-predict per-file bug-proneness risk scores (0.0 – 1.0) and model version."""
    if not files and not process:
        return RiskClientResult(scores={}, model_version="risk-1.0.0")

    settings = get_settings()
    url = f"{settings.ml_service_url.rstrip('/')}/risk"

    # Gather all file paths from both static and process metrics
    all_paths = {f.path for f in files} | set(process.keys())
    files_by_path = {f.path: f for f in files}

    payload_files = []
    for path in sorted(all_paths):
        file_metrics = files_by_path.get(path)
        proc_metrics = process.get(path)

        metrics: dict[str, float] = {}
        if file_metrics:
            metrics["loc"] = float(file_metrics.loc)
            metrics["wmc"] = float(file_metrics.cyclomatic_complexity)
            metrics["max_nested_blocks"] = float(file_metrics.max_nesting_depth)
            metrics["cbo"] = float(file_metrics.cbo)
            metrics["dit"] = float(file_metrics.dit)
            metrics["lcom"] = float(file_metrics.lcom)
            metrics["rfc"] = float(file_metrics.rfc)
            metrics["noc"] = float(file_metrics.noc)
        if proc_metrics:
            metrics["commits_90d"] = float(proc_metrics.commits_90d)
            metrics["author_count"] = float(proc_metrics.author_count)
            metrics["file_age_days"] = float(proc_metrics.file_age_days)
            metrics["recency_days"] = float(proc_metrics.recency_days)

        payload_files.append({"path": path, "metrics": metrics})

    payload = {"files": payload_files}

    try:
        response = httpx.post(url, json=payload, timeout=30.0)
        response.raise_for_status()
        data = response.json()
        model_version = str(data.get("model_version", "risk-1.0.0"))
        raw_scores = data.get("scores", [])
        
        scores: dict[str, float] = {}
        for item in raw_scores:
            p = str(item["path"])
            score = float(item["risk_score"])
            if not (0.0 <= score <= 1.0):
                raise ValueError(f"Risk score {score} out of bounds [0.0, 1.0]")
            scores[p] = score

        return RiskClientResult(scores=scores, model_version=model_version)
    except Exception as exc:
        raise MLServiceUnavailable(f"Failed to communicate with ML risk service: {exc}") from exc
