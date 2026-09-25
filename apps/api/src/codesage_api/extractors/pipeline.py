from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


from codesage_api.extractors.ck_metrics import (
    ClassMetrics,
    FileMetrics,
    MethodMetrics,
    extract_ck_analysis,
)

from codesage_api.extractors.comments import (
    ExtractedComment,
    extract_comments_from_file,
)
from codesage_api.extractors.process_metrics import FileProcessMetrics, extract_process_metrics


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    static_metrics: list[FileMetrics]
    class_metrics: list[ClassMetrics]
    process_metrics: list[FileProcessMetrics]
    comments: list[ExtractedComment]
    method_metrics: list[MethodMetrics] = field(default_factory=list)


def _extract_repository_comments(repository_path: Path) -> list[ExtractedComment]:
    comments: list[ExtractedComment] = []
    for path in sorted(repository_path.rglob("*.java")):
        # A cloned symlink can point anywhere, including at /dev/zero.
        if ".git" in path.parts or path.is_symlink():
            continue
        relative_path = path.relative_to(repository_path).as_posix()
        source_code = path.read_text(encoding="utf-8", errors="replace")
        comments.extend(extract_comments_from_file(relative_path, source_code))
    return comments


def extract(
    repository_path: Path,
    commit_sha: str,
    committer_date: datetime,
) -> ExtractionResult:
    """Extract stored numeric facts plus transient SATD comment inputs."""
    ck_metrics = extract_ck_analysis(repository_path)
    process = extract_process_metrics(repository_path, commit_sha, committer_date)
    comments = _extract_repository_comments(repository_path)

    return ExtractionResult(
        static_metrics=ck_metrics.files,
        class_metrics=ck_metrics.classes,
        process_metrics=process,
        comments=comments,
        method_metrics=ck_metrics.methods,
    )
