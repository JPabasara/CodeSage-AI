"""Analysis-attempt persistence for the scan lifecycle (SRS FR-6)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session, joinedload

from codesage_api.config import get_settings
from codesage_api.db.enums import AnalysisStatus, AnalysisTriggerType
from codesage_api.db.models import (
    AnalysisAttempt,
    AnalysisEngineVersion,
    Branch,
    Repository,
    Snapshot,
)
from codesage_api.guardrails import STALE_GRACE_SECONDS, timed_out_message
from codesage_api.scoring.enums import ScanErrorCode

ENGINE_VERSION_IDENTIFIER = "codesage-v2"
ENGINE_TOOL_VERSIONS: dict[str, object] = {
    "ck": "0.7.0",
    "pydriller": "2.10",
}


@dataclass(frozen=True, slots=True)
class WorkerScanInput:
    repository_url: str
    commit_sha: str
    branch_name: str
    #: How long this repository's recent scans took, for "Usually about 2 min".
    typical_seconds: int | None = None


#: How many recent finished scans the typical duration is taken over.
TYPICAL_SAMPLE = 5


def typical_duration_seconds(session: Session, repository_id: uuid.UUID) -> int | None:
    """The median duration of this repository's last few finished scans.

    A median, not a mean: one scan that sat behind a slow ML call should not
    make every later estimate pessimistic. None before the first finished scan.
    """
    rows = session.execute(
        select(AnalysisAttempt.start_time, AnalysisAttempt.completion_time)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .where(
            Branch.repository_id == repository_id,
            AnalysisAttempt.status == AnalysisStatus.DONE,
            AnalysisAttempt.start_time.is_not(None),
            AnalysisAttempt.completion_time.is_not(None),
        )
        .order_by(AnalysisAttempt.completion_time.desc())
        .limit(TYPICAL_SAMPLE)
    ).all()
    durations: list[float] = sorted(
        (done - started).total_seconds() for started, done in rows if done >= started
    )
    if not durations:
        return None
    return round(durations[len(durations) // 2])


class WorkspaceScanSlotBusy(Exception):
    """The workspace already runs its maximum number of scans. The attempt stays
    queued and the worker asks again later."""


_ACTIVE = (AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)


def lock_repository_for_scan(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
) -> Repository | None:
    """Serialize scan creation with repository removal.

    Both operations lock the same repository row. Whichever transaction wins
    determines the outcome: deletion makes a waiting scan return 404, while a
    queued scan makes a waiting deletion return REPOSITORY_SCAN_RUNNING.
    """
    return session.scalar(
        select(Repository)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
        )
        .with_for_update()
    )


def get_branch(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch_name: str,
) -> Branch | None:
    return session.scalar(
        select(Branch)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
            Branch.name == branch_name,
        )
        .options(joinedload(Branch.repository))
    )


def find_active_for_branch(session: Session, branch_id: uuid.UUID) -> AnalysisAttempt | None:
    """
    check the database to see if there is a queued or running task fo the requested repo.

    """
    return session.scalar(
        select(AnalysisAttempt)
        .where(
            AnalysisAttempt.branch_id == branch_id,
            AnalysisAttempt.status.in_((AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)),
        )
        .order_by(AnalysisAttempt.id.desc())
        .limit(1)
    )


def find_active_for_repository(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
) -> AnalysisAttempt | None:
    """The newest queued or running attempt on any branch of one repository."""
    return session.scalar(
        select(AnalysisAttempt)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
            AnalysisAttempt.status.in_((AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)),
        )
        .order_by(AnalysisAttempt.id.desc())
        .limit(1)
        .options(joinedload(AnalysisAttempt.branch))
    )


def find_latest_completed(session: Session, branch_id: uuid.UUID) -> AnalysisAttempt | None:
    return session.scalar(
        select(AnalysisAttempt)
        .join(Snapshot, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .where(
            AnalysisAttempt.branch_id == branch_id,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
        .order_by(Snapshot.scan_time.desc(), AnalysisAttempt.id.desc())
        .limit(1)
    )


def get_or_create_engine_version(session: Session) -> AnalysisEngineVersion:
    version = session.scalar(
        select(AnalysisEngineVersion).where(
            AnalysisEngineVersion.version_identifier == ENGINE_VERSION_IDENTIFIER
        )
    )
    if version is not None:
        return version

    version = AnalysisEngineVersion(
        version_identifier=ENGINE_VERSION_IDENTIFIER,
        tool_versions=ENGINE_TOOL_VERSIONS.copy(),
        rule_set_version="v1",
        extraction_logic_version="v2",
    )
    session.add(version)
    session.flush()
    return version


def create_queued(
    session: Session,
    branch_id: uuid.UUID,
    commit_sha: str,
    *,
    actor_user_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> AnalysisAttempt:
    version = get_or_create_engine_version(session)
    attempt = AnalysisAttempt(
        branch_id=branch_id,
        initiated_by_user_id=actor_user_id,
        initiating_workspace_id=workspace_id,
        analysis_engine_version_id=version.id,
        commit_sha=commit_sha,
        trigger_type=AnalysisTriggerType.MANUAL,
        status=AnalysisStatus.QUEUED,
    )
    session.add(attempt)
    session.flush()
    return attempt


def get_for_repository(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> AnalysisAttempt | None:
    return session.scalar(
        select(AnalysisAttempt)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            AnalysisAttempt.id == attempt_id,
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
        )
        .options(joinedload(AnalysisAttempt.branch))
    )


def mark_error(session: Session, attempt: AnalysisAttempt, message: str) -> None:
    attempt.status = AnalysisStatus.ERROR
    attempt.failure_information = message
    attempt.failure_code = None
    session.flush()


def expire_stale_running(session: Session, workspace_id: uuid.UUID) -> int:
    """End RUNNING attempts older than any live scan could be.

    The hard time limit kills the worker process, so its `finally` never runs
    and the row would stay RUNNING for good, blocking its branch and, with the
    per-workspace limit, every later scan in the workspace. Called wherever
    "is a scan active?" is asked, so the answer heals itself.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=settings.scan_time_limit_seconds + STALE_GRACE_SECONDS)
    workspace_branches = (
        select(Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(Repository.workspace_id == workspace_id)
    )
    result = session.execute(
        update(AnalysisAttempt)
        .where(
            AnalysisAttempt.branch_id.in_(workspace_branches),
            AnalysisAttempt.status == AnalysisStatus.RUNNING,
            AnalysisAttempt.start_time < cutoff,
        )
        .values(
            status=AnalysisStatus.ERROR,
            completion_time=now,
            failure_information=timed_out_message(),
            failure_code=ScanErrorCode.SCAN_TIMED_OUT.value,
        )
        .execution_options(synchronize_session=False)
    )
    return int(getattr(result, "rowcount", 0) or 0)


def lock_workspace_queue(session: Session, workspace_id: uuid.UUID) -> None:
    """Serialise "count the queue, then add to it" per workspace.

    Transaction-scoped: released by the commit that inserts the new attempt,
    or by the rollback of a refused one. Without it two presses at the same
    moment could both see four waiting and both become the fifth.
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"codesage:scan-queue:{workspace_id}"},
    )


def count_queued_in_workspace(session: Session, workspace_id: uuid.UUID) -> int:
    """Scans waiting for a slot in this workspace — queued, not yet running."""
    return int(
        session.scalar(
            select(func.count(AnalysisAttempt.id))
            .join(Branch, AnalysisAttempt.branch_id == Branch.id)
            .join(Repository, Branch.repository_id == Repository.id)
            .where(
                Repository.workspace_id == workspace_id,
                AnalysisAttempt.status == AnalysisStatus.QUEUED,
            )
        )
        or 0
    )


def count_running_in_workspace(
    session: Session,
    workspace_id: uuid.UUID,
    *,
    excluding: uuid.UUID,
) -> int:
    return int(
        session.scalar(
            select(func.count(AnalysisAttempt.id))
            .join(Branch, AnalysisAttempt.branch_id == Branch.id)
            .join(Repository, Branch.repository_id == Repository.id)
            .where(
                Repository.workspace_id == workspace_id,
                AnalysisAttempt.status == AnalysisStatus.RUNNING,
                AnalysisAttempt.id != excluding,
            )
        )
        or 0
    )


def begin_for_worker(
    session: Session,
    workspace_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> WorkerScanInput | None:
    """Claim a running slot for this attempt, or raise WorkspaceScanSlotBusy.

    None when the attempt is gone or has already ended; a redelivered message
    must not restart a scan that finished, failed or was expired.
    """
    # One transaction-scoped lock per workspace, so two workers cannot both see
    # a free slot and both start. Advisory, so it needs no row the worker's
    # workspace context might not be allowed to lock.
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"codesage:scan-slot:{workspace_id}"},
    )
    attempt = session.scalar(
        select(AnalysisAttempt)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            AnalysisAttempt.id == attempt_id,
            Repository.workspace_id == workspace_id,
        )
        .options(joinedload(AnalysisAttempt.branch).joinedload(Branch.repository))
    )
    if attempt is None or attempt.status not in _ACTIVE:
        return None

    expire_stale_running(session, workspace_id)
    running = count_running_in_workspace(session, workspace_id, excluding=attempt.id)
    if running >= get_settings().max_running_scans_per_workspace:
        raise WorkspaceScanSlotBusy

    attempt.status = AnalysisStatus.RUNNING
    attempt.start_time = datetime.now(UTC)
    attempt.completion_time = None
    attempt.failure_information = None
    attempt.failure_code = None
    session.flush()
    return WorkerScanInput(
        attempt.branch.repository.url,
        attempt.commit_sha,
        attempt.branch.name,
        typical_duration_seconds(session, attempt.branch.repository_id),
    )


def get_worker_attempt(
    session: Session,
    workspace_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> AnalysisAttempt | None:
    return session.scalar(
        select(AnalysisAttempt)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            AnalysisAttempt.id == attempt_id,
            Repository.workspace_id == workspace_id,
        )
    )
