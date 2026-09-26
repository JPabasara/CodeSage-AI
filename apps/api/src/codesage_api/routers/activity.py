"""What is running in the workspace right now: scans and score recalculation."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from codesage_api.deps import get_db, get_workspace_id, require_permission
from codesage_api.schemas import ActivityOut
from codesage_api.services import analysis

router = APIRouter(tags=["scans"])


# A workspace-level read, not a per-repository one: the list spans every project,
# and everyone who may read results in the workspace sees the same work in
# progress, whoever started it. The operation id is set explicitly because the
# contract names it and the derived one would carry the path and method.
@router.get(
    "/activity",
    response_model=ActivityOut,
    operation_id="get_activity",
    dependencies=[Depends(require_permission("result:read"))],
)
def get_activity(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ActivityOut:
    """Every queued or running scan, and every project being re-scored."""
    return analysis.list_activity(db, workspace_id)
