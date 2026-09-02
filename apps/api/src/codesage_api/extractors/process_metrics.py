from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter

from pydriller import Repository  
from codesage_api.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class FileProcessMetrics:
    path: str
    commits_90d: int
    author_count: int
    file_age_days: float
    recency_days: float


@dataclass(slots=True)
class _History:
    commits_90d: set[str]
    authors: set[str]
    first_change: datetime | None = None
    last_change: datetime | None = None


def _java_files(repository_path: Path) -> set[str]:
    return {
        path.relative_to(repository_path).as_posix()
        for path in repository_path.rglob("*.java")
        if ".git" not in path.parts
    }


def extract_process_metrics(
    repository_path: Path,
    commit_sha: str,
    anchor_date: datetime,
) -> list[FileProcessMetrics]:
    """Mine numeric file history, anchored to the scanned commit's date."""
    started = perf_counter()
    files = _java_files(repository_path)
    histories = {path: _History(set(), set()) for path in files}
    window_start = anchor_date - timedelta(days=90)
    commits_inspected = 0

    for commit in Repository(
        str(repository_path),
        to_commit=commit_sha,
    ).traverse_commits():
        commits_inspected += 1
        changed_at = commit.committer_date
        if changed_at > anchor_date:
            continue
        author = commit.author.email or commit.author.name
        for modified in commit.modified_files:
            relative_path = (
                modified.new_path.replace("\\", "/")
                if modified.new_path is not None
                else None
            )
            if relative_path not in histories:
                continue
            history = histories[relative_path]
            if history.first_change is None or changed_at < history.first_change:
                history.first_change = changed_at
            if history.last_change is None or changed_at > history.last_change:
                history.last_change = changed_at
            history.authors.add(author)
            if window_start <= changed_at <= anchor_date:
                history.commits_90d.add(commit.hash)

    results: list[FileProcessMetrics] = []
    for path in sorted(files):
        history = histories[path]
        first = history.first_change or anchor_date
        last = history.last_change or anchor_date
        results.append(
            FileProcessMetrics(
                path=path,
                commits_90d=len(history.commits_90d),
                author_count=len(history.authors),
                file_age_days=max(0.0, (anchor_date - first).total_seconds() / 86400),
                recency_days=max(0.0, (anchor_date - last).total_seconds() / 86400),
            )
        )
    logger.info(
        "Repository history extraction completed",
        extra={
            "event": "stage_completed",
            "stage": "history-extraction",
            "duration_ms": round((perf_counter() - started) * 1000),
            "commits_inspected": commits_inspected,
            "files_measured": len(results),
        },
    )
    return results
