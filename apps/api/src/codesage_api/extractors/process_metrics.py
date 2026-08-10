"""History-derived process metrics via PyDriller (SRS FR-7, FR-11).

Produces exactly four numbers per file — churn, author count, file age, recency —
and nothing else. This module is where the extraction boundary is enforced in
code: PyDriller hands back rich `Commit` and `ModifiedFile` objects including full
commit messages, and everything textual is discarded here rather than downstream.

Process metrics matter because they are empirically the strongest bug-proneness
features available — churn predicts defects better than complexity does — so this
is ML-2's most important input, not a side tool.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True, slots=True)
class FileProcessMetrics:
    file_path: str
    commits_90d: int
    lines_changed_90d: int
    author_count: int
    file_age_days: int
    recency_days: int


def extract(clone_dir: Path, commit_sha: str, committed_at: datetime) -> list[FileProcessMetrics]:
    """Walk the history reachable from `commit_sha` and aggregate per file.

    ⚠️ **The 90-day window is measured backwards from `committed_at` — the scanned
    commit's committer date — never from the wall clock** (SRS FR-11):

        window = [committed_at − 90 days, committed_at]

    This is not a detail. Anchored to `now()`, re-scanning the same SHA months
    later would yield different churn and therefore a different health score,
    which would break REL-10's consistency promise and make skip-if-unchanged
    unsound: the system would serve a cached snapshot whose score no longer
    matched what a fresh scan would produce. Commit-anchoring also means replaying
    an old commit gives the churn that was true *then*, and an untouched
    repository does not drift in score with time alone.

    Wall-clock time is not an input to scoring anywhere in the system.

    `committed_at` is passed in rather than read here so that this stays a pure
    function of its arguments and the anchor is testable without a repository.
    """
    raise NotImplementedError
