"""Analysis-attempt persistence for the scan lifecycle (SRS FR-6)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from codesage_api.db.enums import AnalysisStatus, AnalysisTriggerType
from codesage_api.db.models import (
    AnalysisAttempt,
    AnalysisEngineVersion,
    Branch,
    Repository,
    Snapshot,
)

ENGINE_VERSION_IDENTIFIER = "codesage-v2"
ENGINE_TOOL_VERSIONS: dict[str, object] = {
    "ck": "0.7.0",
    "pydriller": "2.10",
}


@dataclass(frozen=True, slots=True)
class WorkerScanInput:
    repository_url: str
    commit_sha: str


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


def find_active_for_branch(
    session: Session, branch_id: uuid.UUID
) -> AnalysisAttempt | None:
    return session.scalar(
        select(AnalysisAttempt)
        .where(
            AnalysisAttempt.branch_id == branch_id,
            AnalysisAttempt.status.in_(
                (AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)
            ),
        )
        .order_by(AnalysisAttempt.id.desc())
        .limit(1)
    )


def find_latest_completed(
    session: Session, branch_id: uuid.UUID
) -> AnalysisAttempt | None:
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
    session: Session, branch_id: uuid.UUID, commit_sha: str
) -> AnalysisAttempt:
    version = get_or_create_engine_version(session)
    attempt = AnalysisAttempt(
        branch_id=branch_id,
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


def mark_error(
    session: Session, attempt: AnalysisAttempt, message: str
) -> None:
    attempt.status = AnalysisStatus.ERROR
    attempt.failure_information = message
    session.flush()


def begin_for_worker(
    session: Session,
    workspace_id: uuid.UUID,
    attempt_id: uuid.UUID,
) -> WorkerScanInput | None:
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
    if attempt is None:
        return None
    attempt.status = AnalysisStatus.RUNNING
    attempt.start_time = datetime.now(UTC)
    attempt.failure_information = None
    session.flush()
    return WorkerScanInput(attempt.branch.repository.url, attempt.commit_sha)


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
