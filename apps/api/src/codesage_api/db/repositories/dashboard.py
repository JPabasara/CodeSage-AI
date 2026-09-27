"""Tenant-safe reads for finalized snapshot facts."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import (
    AnalysisAttempt,
    Branch,
    BugRiskPrediction,
    ClassRiskPrediction,
    Finding,
    Repository,
    SATDPrediction,
    Snapshot,
    SnapshotScore,
    SourceFile,
    SourceLocation,
)

#: How long a pending or running score counts as work in progress. A score
#: takes well under a minute even on a large repository; a row older than this
#: belongs to a job that was lost (a worker restart, a dropped message), and
#: must not show as "re-scoring" forever.
RESCORING_WINDOW = timedelta(minutes=15)


@dataclass(frozen=True, slots=True)
class RescoringRow:
    repository_id: uuid.UUID
    owner: str
    name: str
    snapshots_left: int


def _scoring_options():
    return (
        joinedload(Snapshot.analysis_attempt).joinedload(AnalysisAttempt.branch),
        selectinload(Snapshot.source_files).selectinload(SourceFile.static_metrics),
        selectinload(Snapshot.source_files).selectinload(SourceFile.process_metric),
        selectinload(Snapshot.source_files)
        .selectinload(SourceFile.bug_risk_predictions)
        .joinedload(BugRiskPrediction.model_version),
        selectinload(Snapshot.source_files)
        .selectinload(SourceFile.class_risk_predictions)
        .joinedload(ClassRiskPrediction.model_version),
        selectinload(Snapshot.source_files)
        .selectinload(SourceFile.source_locations)
        .joinedload(SourceLocation.code_symbol),
        selectinload(Snapshot.source_files)
        .selectinload(SourceFile.source_locations)
        .selectinload(SourceLocation.findings)
        .joinedload(Finding.satd_prediction)
        .joinedload(SATDPrediction.model_version),
    )


def list_completed_snapshots(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch_name: str,
) -> list[Snapshot]:
    """Return immutable snapshots oldest-first, with all scoring facts loaded."""
    statement = (
        select(Snapshot)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
            Branch.name == branch_name,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
        .options(*_scoring_options())
        .order_by(Snapshot.scan_time.asc(), Snapshot.id.asc())
    )
    return list(session.scalars(statement).unique().all())


def list_latest_completed_snapshot_refs(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch_name: str,
    *,
    limit: int = 2,
) -> list[Snapshot]:
    """Return only lightweight snapshot rows, newest first."""
    statement = (
        select(Snapshot)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
            Branch.name == branch_name,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
        .order_by(Snapshot.scan_time.desc(), Snapshot.id.desc())
        .limit(limit)
    )
    return list(session.scalars(statement).all())


def list_completed_snapshot_refs(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch_name: str | None,
) -> list[Snapshot]:
    """Return lightweight snapshot rows oldest-first, optionally for one branch."""
    statement = (
        select(Snapshot)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
        .options(joinedload(Snapshot.analysis_attempt).joinedload(AnalysisAttempt.branch))
        .order_by(Snapshot.scan_time.asc(), Snapshot.id.asc())
    )
    if branch_name is not None:
        statement = statement.where(Branch.name == branch_name)
    return list(session.scalars(statement).all())


def repository_id_for_snapshot(
    session: Session,
    workspace_id: uuid.UUID,
    snapshot_id: uuid.UUID,
) -> uuid.UUID | None:
    """Which project a snapshot belongs to — the key to its effective profile."""
    return session.scalar(
        select(Repository.id)
        .join(Branch, Branch.repository_id == Repository.id)
        .join(AnalysisAttempt, AnalysisAttempt.branch_id == Branch.id)
        .join(Snapshot, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .where(Snapshot.id == snapshot_id, Repository.workspace_id == workspace_id)
    )


def find_done_snapshot(
    session: Session,
    workspace_id: uuid.UUID,
    snapshot_id: uuid.UUID,
) -> Snapshot | None:
    """The snapshot row alone — no files, classes or findings.

    For callers that only need to know the snapshot exists and is complete.
    Loading every fact of a large repository just to check that took ~40 s.
    """
    return session.scalar(
        select(Snapshot)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Snapshot.id == snapshot_id,
            Repository.workspace_id == workspace_id,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
    )


def get_snapshot_for_scoring(
    session: Session,
    workspace_id: uuid.UUID,
    snapshot_id: uuid.UUID,
) -> Snapshot | None:
    statement = (
        select(Snapshot)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Snapshot.id == snapshot_id,
            Repository.workspace_id == workspace_id,
            AnalysisAttempt.status == AnalysisStatus.DONE,
        )
        .options(*_scoring_options())
    )
    return session.scalars(statement).unique().one_or_none()


def list_rescoring(session: Session, workspace_id: uuid.UUID) -> list[RescoringRow]:
    """Projects in the workspace with scores still pending or running.

    Counted per snapshot, not per score row: one snapshot can hold a waiting row
    for more than one profile, and the user waits for scans, not rows. Only rows
    created or started within RESCORING_WINDOW count, measured with the
    database clock that stamps `computed_at`.
    """
    repo_name = func.concat(Repository.owner, "/", Repository.name)
    recent = func.coalesce(SnapshotScore.started_at, SnapshotScore.computed_at) >= (
        func.now() - RESCORING_WINDOW
    )
    rows = session.execute(
        select(
            Repository.id,
            Repository.owner,
            Repository.name,
            func.count(func.distinct(SnapshotScore.snapshot_id)),
        )
        .select_from(SnapshotScore)
        .join(Snapshot, SnapshotScore.snapshot_id == Snapshot.id)
        .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.workspace_id == workspace_id,
            SnapshotScore.status.in_(("pending", "running")),
            recent,
        )
        .group_by(Repository.id, Repository.owner, Repository.name)
        .order_by(repo_name.asc(), Repository.id.asc())
    ).all()
    return [
        RescoringRow(repository_id, owner, name, int(count))
        for repository_id, owner, name, count in rows
    ]
