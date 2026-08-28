"""Tenant-safe reads for finalized snapshot facts."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import (
    AnalysisAttempt,
    Branch,
    BugRiskPrediction,
    Finding,
    Repository,
    SATDPrediction,
    Snapshot,
    SourceFile,
    SourceLocation,
)


def _scoring_options():
    return (
        joinedload(Snapshot.analysis_attempt).joinedload(AnalysisAttempt.branch),
        selectinload(Snapshot.source_files).selectinload(SourceFile.static_metrics),
        selectinload(Snapshot.source_files).selectinload(SourceFile.process_metric),
        selectinload(Snapshot.source_files)
        .selectinload(SourceFile.bug_risk_predictions)
        .joinedload(BugRiskPrediction.model_version),
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
