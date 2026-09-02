"""ML-2 client: file metrics in, per-file risk score out (SRS FR-10).

Calls the /risk endpoint on the ML service. Degrades gracefully by raising
MLServiceUnavailable when the container is down or returns a malformed response.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from codesage_api.config import get_settings
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


@dataclass(frozen=True, slots=True)
class RiskClientResult:
    scores: dict[str, float]
    model_version: str
    model_kind: str


RISK_FEATURES = (
    "wmc",
    "cbo",
    "dit",
    "lcom",
    "rfc",
    "noc",
    "loc",
    "max_nested_blocks",
    "comment_ratio",
    "commits_90d",
    "author_count",
    "file_age_days",
    "recency_days",
)


def predict(files: list[FileMetrics], process: dict[str, FileProcessMetrics]) -> RiskClientResult:
    """Batch-predict per-file bug-proneness risk scores (0.0 – 1.0) and model version."""
    if not files:
        return RiskClientResult(scores={}, model_version="", model_kind="")

    settings = get_settings()
    url = f"{settings.ml_service_url.rstrip('/')}/risk"

    # ML-2 is Java/file scoped. History can contain deleted or non-Java paths,
    # but those have no compatible CK vector and must not be predicted.
    all_paths = {f.path for f in files}
    files_by_path = {f.path: f for f in files}

    payload_files = []
    for path in sorted(all_paths):
        file_metrics = files_by_path.get(path)
        proc_metrics = process.get(path)

        # Newly created files may have no Git history. Send the complete wire
        # contract anyway: absence is represented by zero, not a missing key.
        metrics = dict.fromkeys(RISK_FEATURES, 0.0)
        if file_metrics:
            metrics["loc"] = float(file_metrics.loc)
            metrics["wmc"] = float(file_metrics.cyclomatic_complexity)
            metrics["max_nested_blocks"] = float(file_metrics.max_nesting_depth)
            metrics["cbo"] = float(file_metrics.cbo)
            metrics["dit"] = float(file_metrics.dit)
            metrics["lcom"] = float(file_metrics.lcom)
            metrics["rfc"] = float(file_metrics.rfc)
            metrics["noc"] = float(file_metrics.noc)
            # CK does not currently emit comment lines. Keep the constant
            # explicit so the wire contract still has all 13 canonical fields.
            metrics["comment_ratio"] = 0.0
        if proc_metrics:
            metrics["commits_90d"] = float(proc_metrics.commits_90d)
            metrics["author_count"] = float(proc_metrics.author_count)
            metrics["file_age_days"] = float(proc_metrics.file_age_days)
            metrics["recency_days"] = float(proc_metrics.recency_days)

        payload_files.append({"path": path, "metrics": metrics})

    payload = {"files": payload_files}

    try:
        response = httpx.post(url, json=payload, timeout=settings.ml_timeout_seconds)
        response.raise_for_status()
        data = response.json()
        model_version = data.get("model_version")
        model_kind = data.get("model_kind")
        raw_scores = data.get("scores")
        if not isinstance(model_version, str) or not model_version.strip():
            raise ValueError("Risk response is missing model_version")
        if not isinstance(raw_scores, list):
            raise TypeError("Risk response scores must be a list")
        if model_kind not in {"trained", "heuristic"}:
            raise ValueError("Risk response has an invalid model_kind")

        scores: dict[str, float] = {}
        for item in raw_scores:
            p = str(item["path"])
            if p not in all_paths:
                raise ValueError(f"Risk response contains unexpected path {p!r}")
            if p in scores:
                raise ValueError(f"Risk response contains duplicate path {p!r}")
            score = float(item["risk_score"])
            if not (0.0 <= score <= 1.0):
                raise ValueError(f"Risk score {score} out of bounds [0.0, 1.0]")
            scores[p] = score

        missing_paths = all_paths - scores.keys()
        if missing_paths:
            raise ValueError(f"Risk response is missing paths: {', '.join(sorted(missing_paths))}")

        return RiskClientResult(
            scores=scores,
            model_version=model_version.strip(),
            model_kind=model_kind,
        )
    except Exception as exc:
        raise MLServiceUnavailable(f"Failed to communicate with ML risk service: {exc}") from exc
