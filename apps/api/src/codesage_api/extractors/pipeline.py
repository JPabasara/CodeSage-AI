from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Protocol

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
from codesage_api.extractors.process_metrics import (
    CommitProgress,
    FileProcessMetrics,
    count_commits,
    extract_process_metrics,
)
from codesage_api.scoring.enums import ScanStep


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    static_metrics: list[FileMetrics]
    class_metrics: list[ClassMetrics]
    process_metrics: list[FileProcessMetrics]
    comments: list[ExtractedComment]
    method_metrics: list[MethodMetrics] = field(default_factory=list)


#: Called as `on_file(files_done, files_total)` after each Java file is read.
FileProgress = Callable[[int, int], None]


class StepProgress(Protocol):
    """Called as each sub-step of reading the code starts, with the percentage
    where its band begins and the total its count will run to, if it has one."""

    def __call__(
        self,
        step: ScanStep,
        percent: int,
        *,
        files_total: int | None = None,
        commits_total: int | None = None,
    ) -> None: ...


def _comment_paths(repository_path: Path) -> list[Path]:
    # A cloned symlink can point anywhere, including at /dev/zero.
    return [
        path
        for path in sorted(repository_path.rglob("*.java"))
        if ".git" not in path.parts and not path.is_symlink()
    ]


def _extract_repository_comments(
    repository_path: Path,
    on_file: FileProgress | None = None,
    *,
    paths: list[Path] | None = None,
) -> list[ExtractedComment]:
    comments: list[ExtractedComment] = []
    if paths is None:
        paths = _comment_paths(repository_path)
    for done, path in enumerate(paths, start=1):
        relative_path = path.relative_to(repository_path).as_posix()
        source_code = path.read_text(encoding="utf-8", errors="replace")
        comments.extend(extract_comments_from_file(relative_path, source_code))
        if on_file is not None:
            on_file(done, len(paths))
    return comments


def extract(
    repository_path: Path,
    commit_sha: str,
    committer_date: datetime,
    on_file: FileProgress | None = None,
    on_step: StepProgress | None = None,
    on_commit: CommitProgress | None = None,
) -> ExtractionResult:
    """Extract stored numeric facts plus transient SATD comment inputs.

    `on_step` hears each sub-step as it starts: measuring_code at 25,
    reading_history at 37 with the commit count, reading_comments at 52 with
    the file count. `on_commit` hears the history walk, and `on_file` each
    Java file as the comment pass reads it.
    """
    if on_step is not None:
        on_step(ScanStep.MEASURING_CODE, 25)
    ck_metrics = extract_ck_analysis(repository_path)

    commits_total = (
        count_commits(repository_path, commit_sha)
        if on_step is not None or on_commit is not None
        else None
    )
    if on_step is not None:
        on_step(ScanStep.READING_HISTORY, 37, commits_total=commits_total)
    process = extract_process_metrics(
        repository_path,
        commit_sha,
        committer_date,
        # Uncounted history reports no commits rather than counting again.
        on_commit if commits_total is not None else None,
        commits_total=commits_total,
    )

    paths = _comment_paths(repository_path)
    if on_step is not None:
        on_step(ScanStep.READING_COMMENTS, 52, files_total=len(paths))
    comments = _extract_repository_comments(repository_path, on_file, paths=paths)

    return ExtractionResult(
        static_metrics=ck_metrics.files,
        class_metrics=ck_metrics.classes,
        process_metrics=process,
        comments=comments,
        method_metrics=ck_metrics.methods,
    )
