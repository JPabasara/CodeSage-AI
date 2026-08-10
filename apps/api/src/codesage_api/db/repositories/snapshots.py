"""SNAPSHOT queries: finalization, the dashboard read, history and the trend."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import Snapshot


def finalize(
    session: Session,
    attempt_id: uuid.UUID,
    findings: list[dict],
    source_files: list[dict],
    tree_nodes: list[dict],
) -> Snapshot:
    """Atomically commit a completed analysis as a finalized result (DBR-22).

    Everything or nothing: the snapshot row, its source files, metrics, findings,
    predictions and tree all land in ONE transaction. A partially written snapshot
    would be indistinguishable from a clean one on read, and REL-05 requires that
    an incomplete result never replaces a valid one.

    This is also why cancellation is cooperative rather than forced (SAD §6
    decision 7): the worker checks the cancel flag *between* stages, and once it
    has begun writing it finishes. Killing the process mid-write is precisely what
    this transaction exists to make impossible.
    """
    raise NotImplementedError


def latest(session: Session, repository_id: uuid.UUID, branch: str) -> Snapshot | None:
    """The newest finalized snapshot for a repo+branch — what the dashboard renders.

    No phase filter is needed: only successful attempts produce snapshots, so
    existence in this table *is* the success condition.
    """
    raise NotImplementedError


def history(
    session: Session, repository_id: uuid.UUID, branch: str, limit: int = 50
) -> list[Snapshot]:
    """Snapshots newest-first, for Scan History (FR-19) and the trend chart (FR-14).

    Returns rows only. Every trend point must then be re-scored under the
    *currently active* profile, not under whatever profile was active when each
    scan ran — mixing profiles along one line would make a settings change
    indistinguishable from a code change, so the chart would read "the codebase got
    worse" when it means "we changed our mind about what matters".
    """
    raise NotImplementedError


def previous(session: Session, snapshot: Snapshot) -> Snapshot | None:
    """The snapshot immediately before this one on the same branch — the `delta` base.

    Delta is derived, not stored: both snapshots are re-scored under the active
    profile and subtracted, so the number stays truthful after a profile change.
    """
    raise NotImplementedError
