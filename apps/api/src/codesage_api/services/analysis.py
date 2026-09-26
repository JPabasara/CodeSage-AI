from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt
from codesage_api.db.repositories import attempts
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import NotFound, ScanAlreadyRunning
from codesage_api.integrations.github import fetch_branch
from codesage_api.schemas import ScanStatusOut, ScanSummaryOut
from codesage_api.scoring.enums import ScanErrorCode, ScanPhase, ScanStage
from codesage_api.services import dashboard
from codesage_api.tasks import progress


def _status_out(
    attempt: AnalysisAttempt,
    branch_name: str,
) -> ScanStatusOut:
    phase = ScanPhase(attempt.status.value)
    failed = attempt.status == AnalysisStatus.ERROR
    # Stage details mean something only while the worker is running; every
    # other phase answers without asking Redis at all.
    reading = progress.ProgressReading()
    if phase is ScanPhase.DONE:
        percent = 100
    elif phase in {ScanPhase.QUEUED, ScanPhase.ERROR, ScanPhase.CANCELLED}:
        percent = 0
    else:
        reading = progress.read_status(str(attempt.id))
        percent = reading.percent

    return ScanStatusOut(
        scan_id=str(attempt.id),
        phase=phase,
        progress=percent,
        branch=branch_name,
        commit_sha=attempt.commit_sha,
        started_at=(attempt.start_time.isoformat() if attempt.start_time else None),
        finished_at=(attempt.completion_time.isoformat() if attempt.completion_time else None),
        error=(attempt.failure_information if failed else None),
        error_code=_error_code(attempt.failure_code) if failed else None,
        stage=_stage(reading.stage),
        files_done=reading.files_done,
        files_total=reading.files_total,
        typical_seconds=reading.typical_seconds,
    )


def _stage(stored: str | None) -> ScanStage | None:
    """An unknown stage from a newer worker reads as "not reported"."""
    try:
        return ScanStage(stored) if stored else None
    except ValueError:
        return None


def _error_code(stored: str | None) -> ScanErrorCode | None:
    """A code this build no longer knows is dropped, not a 500: the stored
    sentence still explains the failure."""
    try:
        return ScanErrorCode(stored) if stored else None
    except ValueError:
        return None


def start(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    *,
    actor_user_id: uuid.UUID,
) -> ScanStatusOut:

    # Repository removal takes this same row lock. Keep it until the queued
    # attempt is committed so a concurrent delete cannot pass its active-scan
    # check in the gap between this check and create_queued().
    if attempts.lock_repository_for_scan(session, workspace_id, repository_id) is None:
        raise NotFound

    stored_branch = attempts.get_branch(session, workspace_id, repository_id, branch)
    if stored_branch is None:
        raise NotFound

    attempts.expire_stale_running(session, workspace_id)
    if attempts.find_active_for_branch(session, stored_branch.id) is not None:
        raise ScanAlreadyRunning

    remote_branch = fetch_branch(
        stored_branch.repository.owner,
        stored_branch.repository.name,
        stored_branch.name,
    )
    stored_branch.head_commit_sha = remote_branch.head_commit_sha

    completed = attempts.find_latest_completed(session, stored_branch.id)

    # check if there is new commit
    if completed is not None and completed.commit_sha == remote_branch.head_commit_sha:
        return _status_out(completed, stored_branch.name)

    attempt = attempts.create_queued(
        session,
        stored_branch.id,
        remote_branch.head_commit_sha,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
    )

    session.commit()

    set_workspace_context(session, workspace_id)
    try:
        from codesage_api.tasks.scan_pipeline import run_scan

        run_scan.delay(str(attempt.id), str(workspace_id))
    except Exception as exc:
        attempts.mark_error(session, attempt, "The scan could not be queued.")
        session.commit()
        raise RuntimeError("The scan could not be queued.") from exc

    return _status_out(attempt, stored_branch.name)


def get_status(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> ScanStatusOut:

    attempts.expire_stale_running(session, workspace_id)
    attempt = attempts.get_for_repository(session, workspace_id, repository_id, attempt_id)
    if attempt is None:
        raise NotFound
    return _status_out(attempt, attempt.branch.name)


def get_active(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str | None,
) -> ScanStatusOut | None:
    """The scan still queued or running, if there is one.

    A client only learns a scan id from the POST that started it, so a page that
    was closed, refreshed, opened in another tab or on another device — or a
    teammate's scan — was invisible until it finished. This is how a client finds
    it again and resumes polling. With a branch, only that branch; without one,
    the newest active scan on any branch of the repository.
    """
    attempts.expire_stale_running(session, workspace_id)
    if branch is None:
        attempt = attempts.find_active_for_repository(session, workspace_id, repository_id)
    else:
        stored_branch = attempts.get_branch(session, workspace_id, repository_id, branch)
        if stored_branch is None:
            raise NotFound
        attempt = attempts.find_active_for_branch(session, stored_branch.id)
    if attempt is None:
        return None
    return _status_out(attempt, attempt.branch.name)


def get_history(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str | None,
) -> list[ScanSummaryOut]:
    return dashboard.build_scan_history(
        session,
        workspace_id,
        repository_id,
        branch,
    )


def cancel(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> ScanStatusOut:

    attempt = attempts.get_for_repository(
        session,
        workspace_id,
        repository_id,
        attempt_id,
    )
    if attempt is None:
        raise NotFound
    if attempt.status in {AnalysisStatus.QUEUED, AnalysisStatus.RUNNING}:
        progress.request_cancel(str(attempt.id))
    return _status_out(attempt, attempt.branch.name)
