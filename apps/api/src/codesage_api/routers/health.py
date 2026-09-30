from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import require_health_read
from codesage_api.deps import get_db, get_workspace_id
from codesage_api.schemas import HealthReportOut
from codesage_api.schemas.health import CalibrationRecordOut
from codesage_api.services import dashboard

router = APIRouter(prefix="/repos/{repo_id}", tags=["dashboard"])


@router.get("/health", response_model=HealthReportOut, dependencies=[Depends(require_health_read)])
def get_health_report(
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    snapshot_id: uuid.UUID | None = None,
) -> HealthReportOut:
    """Return the latest or selected finalized snapshot, scored on this read."""
    return dashboard.build_health_report(
        db,
        workspace_id,
        repo_id,
        branch,
        snapshot_id,
    )


@router.get(
    "/health/calibration-export",
    response_model=CalibrationRecordOut,
    dependencies=[Depends(require_health_read)],
)
def get_calibration_export(
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    snapshot_id: uuid.UUID | None = None,
) -> CalibrationRecordOut:
    """Export one completed scan using the exact cached production score scope."""
    return dashboard.build_calibration_export(
        db, workspace_id, repo_id, branch, snapshot_id
    )
