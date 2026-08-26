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
        .options(
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
        .order_by(Snapshot.scan_time.asc(), Snapshot.id.asc())
    )
    return list(session.scalars(statement).unique().all())
