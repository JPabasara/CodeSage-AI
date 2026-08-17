"""AnalysisOrchestrator — the scan lifecycle, as seen from the API (SRS FR-6).

Starts, monitors, cancels and may skip analyses. Everything here runs in the API
process; the pipeline itself runs in `tasks/`.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.schemas import ScanStatusOut


def start(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID, branch: str
) -> ScanStatusOut:
    """Decide whether to scan, and if so enqueue it and return immediately.

        1. read the branch head SHA from GitHub (REST, ETag-conditional)
        2. read the SHA of the last SUCCESSFULLY COMPLETED analysis
        3. if equal → return the existing snapshot's status; nothing is queued
        4. otherwise → insert an AnalysisAttempt (queued), enqueue, return 202

    **Steps 1–3 happen here, in the API, before anything is queued.** The check
    costs one conditional REST call and one indexed read, so a skipped scan returns
    a dashboard inside PERF-02's one second. Deciding it in the worker instead
    would mean queuing a job, occupying a worker and cloning a repository only to
    discover nothing had changed.

    Step 2's "successfully completed" is load-bearing: a cancelled or failed
    attempt has no Snapshot, and skipping on the basis of one would serve a
    snapshot that was never written.
    """
    raise NotImplementedError


def get_status(session: Session, attempt_id: uuid.UUID) -> ScanStatusOut:
    """Phase from PostgreSQL, progress percentage from Redis.

    Two stores because they guarantee different things: a lost percentage is
    recomputed by the next poll, whereas a lost failure would break SP-13's
    requirement that the final phase be recoverable from the database alone.
    """
    raise NotImplementedError


def cancel(session: Session, attempt_id: uuid.UUID) -> ScanStatusOut:
    """Request cancellation. Sets a Redis flag and returns; does not stop the worker.

    Cooperative by design — see `tasks/cancel.py` for why forcing it would risk a
    partial snapshot. The user learns the scan really stopped through the polling
    channel they are already using, when the next poll returns `cancelled`.
    """
    raise NotImplementedError
