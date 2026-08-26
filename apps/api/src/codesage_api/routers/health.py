from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from codesage_api.deps import get_db, get_workspace_id
from codesage_api.schemas import HealthReportOut
from codesage_api.services import dashboard

router = APIRouter(prefix="/repos/{repo_id}", tags=["dashboard"])


@router.get("/health", response_model=HealthReportOut)
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
