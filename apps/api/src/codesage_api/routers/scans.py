"""Scan lifecycle endpoints.
idle → queued → running NN% → done | error | cancelled
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import (
    require_repository_permission,
    require_scan_cancel,
    require_scan_read,
)
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.schemas import ScanStatusOut, ScanSummaryOut, StartScanIn
from codesage_api.services import analysis

router = APIRouter(prefix="/repos/{repo_id}", tags=["scans"])


@router.post(
    "/scan",
    response_model=ScanStatusOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_repository_permission("scan:start"))],
)
def start_scan(
    repo_id: uuid.UUID,
    body: StartScanIn,
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScanStatusOut:
    """
    Start a scan; return a scan identifier and phase immediately.

    The API answers before the work begins. It inserts the AnalysisAttempt row,
    enqueues the job and returns 202 with phase `queued`. The client then polls
    once per second.

    Skip-if-unchanged is decided here, before anything is queued.
    """
    return analysis.start(db, workspace_id, repo_id, body.branch, actor_user_id=user_id)


# Registered before `/scan/{scan_id}`: that route would otherwise take "active"
# as a scan id and answer 422.
@router.get(
    "/scan/active",
    response_model=ScanStatusOut,
    responses={204: {"description": "No scan is queued or running."}},
    dependencies=[Depends(require_repository_permission("result:read"))],
)
def get_active_scan(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    branch: Annotated[str | None, Query(min_length=1)] = None,
) -> ScanStatusOut | Response:
    """The scan still queued or running for this repository (or one branch of it).

    200 with its status, or 204 when there is none. Lets a client that did not
    start the scan — or no longer holds its id — find it and resume polling.
    """
    active = analysis.get_active(db, workspace_id, repo_id, branch)
    if active is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return active


@router.get(
    "/scan/{scan_id}", response_model=ScanStatusOut, dependencies=[Depends(require_scan_read)]
)
def get_scan_status(
    repo_id: uuid.UUID,
    scan_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScanStatusOut:
    """Poll phase and progress. Called once per second while a scan is active.

    **Reads from two places, deliberately.** `phase` comes from PostgreSQL and the
    progress percentage from Redis. The split follows from what each store
    guarantees: Redis is a broker, so losing a percentage on restart costs nothing
    because the next poll produces a new one — whereas losing the fact that a scan
    failed would break SP-13, which requires the final phase and its error to be
    recoverable from the database alone.

    Polling rather than WebSockets or SSE is a v1.0 decision: it gives continuous
    progress without the deployment complexity of a second protocol.
    """
    return analysis.get_status(db, workspace_id, repo_id, scan_id)


@router.post(
    "/scan/{scan_id}/stop",
    response_model=ScanStatusOut,
    dependencies=[Depends(require_scan_cancel)],
)
def stop_scan(
    repo_id: uuid.UUID,
    scan_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScanStatusOut:
    """Cancel a running scan.

    **Cancellation is cooperative, not forced.** This endpoint does not stop the
    worker. It sets a flag in Redis and returns immediately; the worker reads that
    flag between pipeline stages, stops at the first boundary it reaches, deletes
    its clone and writes phase `cancelled`.

    Finalization is outside that window: once the worker has begun writing the
    snapshot it finishes. Terminating mid-write would leave a partial snapshot, and
    FR-6 requires the previous snapshot to remain intact after a cancellation.

    The cost is response time — a user who presses Stop waits until the current
    stage ends — and the result reaches them through the polling channel they are
    already using, because the worker writes `cancelled` to the same row the status
    endpoint reads. No separate notification path is needed.
    """
    return analysis.cancel(db, workspace_id, repo_id, scan_id)


@router.get(
    "/scans",
    response_model=list[ScanSummaryOut],
    dependencies=[Depends(require_repository_permission("history:read"))],
)
def list_scan_history(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    branch: Annotated[str | None, Query(min_length=1)] = None,
) -> list[ScanSummaryOut]:
    """Past snapshots for the repository, optionally restricted to one branch (FR-19).

    Each row: date, commit SHA, health score, grade, delta, finding count. The last
    three are derived under the active profile, not read from a column.
    """
    return analysis.get_history(db, workspace_id, repo_id, branch)
