"""ANALYSIS_ATTEMPT queries: the scan lifecycle row and the skip-if-unchanged check.

Named `attempts`, not `scans`, because that is what these rows are: a record that
something was tried. The finalized results live in `snapshots.py`.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from codesage_api.db.models import AnalysisAttempt
from codesage_api.scoring.enums import ScanPhase


def create_queued(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    commit_sha: str,
    commit_committed_at: datetime | None,
    engine_version_id: uuid.UUID | None,
) -> AnalysisAttempt:
    """Insert an attempt in phase `queued`.

    Runs on the request thread, before the job is enqueued, so the API can return a
    scan identifier within the 1 s PERF-03 allows.
    """
    raise NotImplementedError


def get(session: Session, attempt_id: uuid.UUID) -> AnalysisAttempt | None:
    raise NotImplementedError


def last_successful_sha(session: Session, repository_id: uuid.UUID, branch: str) -> str | None:
    """The commit SHA of the most recent SUCCESSFULLY COMPLETED analysis (DBR-10).

    ⚠️ Successful, not merely most recent. A cancelled or failed attempt leaves a
    row here with no Snapshot because the worker stopped before finalization. If
    the branch head were compared against such a row, the system would skip the
    work and then serve a snapshot that was never written (SAD §6 decision 3).

    Implemented as a join to SNAPSHOT rather than a `phase = 'done'` filter, so the
    guarantee is structural: no snapshot, no match.
    """
    raise NotImplementedError


def mark_running(session: Session, attempt_id: uuid.UUID) -> None:
    raise NotImplementedError


def mark_terminal(
    session: Session,
    attempt_id: uuid.UUID,
    phase: ScanPhase,
    failure_reason: str | None = None,
) -> None:
    """Write a terminal phase — done, error or cancelled — to the database.

    Every terminal phase is written by the process that reaches it, because SRS
    SP-13 requires the final phase and its error message to be recoverable from the
    database alone. Redis carries the progress percentage and the cancel flag, and
    losing either on a broker restart is harmless; losing the fact that a scan
    failed is not.
    """
    raise NotImplementedError


def increment_retry(session: Session, attempt_id: uuid.UUID) -> None:
    """Record a Celery retry after a transient failure (REL-04, DBR-6)."""
    raise NotImplementedError
