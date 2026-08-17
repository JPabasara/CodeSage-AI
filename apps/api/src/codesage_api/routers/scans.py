"""Scan lifecycle endpoints (SRS FR-6).

    idle → queued → running NN% → done | error | cancelled
"""

from __future__ import annotations

from fastapi import APIRouter, status

from codesage_api.schemas import ScanStatusOut, ScanSummaryOut, StartScanIn

router = APIRouter(prefix="/repos/{repo_id}", tags=["scans"])


@router.post("/scan", response_model=ScanStatusOut, status_code=status.HTTP_202_ACCEPTED)
def start_scan(repo_id: str, body: StartScanIn) -> ScanStatusOut:
    """Start a scan; return a scan identifier and phase immediately.

    **The API answers before the work begins.** It inserts the AnalysisAttempt row,
    enqueues the job and returns 202 with phase `queued`. The client then polls
    once per second. Running the pipeline inside the request would hold the
    connection open for minutes and make PERF-03 and PERF-05 impossible.

    **Skip-if-unchanged is decided here, before anything is queued.** The API reads
    the branch head SHA from GitHub and compares it against the SHA of the last
    *successfully completed* analysis. If they match, no job is queued and no
    worker is occupied — one conditional REST call and one indexed read, well
    inside the 1 s PERF-02 allows. Deciding this in the worker instead would mean
    queuing, occupying a worker and cloning a repository only to discover nothing
    had changed.

    The "successfully completed" qualifier is load-bearing: a cancelled or failed
    attempt leaves a row with no Snapshot, and comparing against one would make the
    system skip the work and then serve a snapshot that was never written.
    """
    raise NotImplementedError


@router.get("/scan/{scan_id}", response_model=ScanStatusOut)
def get_scan_status(repo_id: str, scan_id: str) -> ScanStatusOut:
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
    raise NotImplementedError


@router.post("/scan/{scan_id}/stop", response_model=ScanStatusOut)
def stop_scan(repo_id: str, scan_id: str) -> ScanStatusOut:
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
    raise NotImplementedError


@router.get("/scans", response_model=list[ScanSummaryOut])
def list_scan_history(repo_id: str, branch: str | None = None) -> list[ScanSummaryOut]:
    """Past snapshots for the active project and branch (FR-19).

    Each row: date, commit SHA, health score, grade, delta, finding count. The last
    three are derived under the active profile, not read from a column.
    """
    raise NotImplementedError
