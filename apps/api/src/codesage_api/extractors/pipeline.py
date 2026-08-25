"""The complete FR-7 extraction stage over one immutable working tree."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from codesage_api.extractors.ck_metrics import FileMetrics, extract_ck_metrics
from codesage_api.extractors.comments import ExtractedComment, extract_comments
from codesage_api.extractors.process_metrics import FileProcessMetrics, extract_process_metrics


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    static_metrics: list[FileMetrics]
    process_metrics: list[FileProcessMetrics]
    comments: list[ExtractedComment]


def extract(
    repository_path: Path,
    commit_sha: str,
    committer_date: datetime,
) -> ExtractionResult:
    """Extract stored numeric facts plus transient SATD comment inputs."""
    static = extract_ck_metrics(repository_path)
    process = extract_process_metrics(repository_path, commit_sha, committer_date)
    comments = extract_comments(repository_path)
    return ExtractionResult(static, process, comments)
