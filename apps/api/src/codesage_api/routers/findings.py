from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, status
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.authorization.routes import require_snapshot_permission
from codesage_api.deps import get_db
from codesage_api.schemas.finding import FindingStatusIn
from codesage_api.services import finding_triage

router = APIRouter(prefix="/snapshots/{snapshot_id}/findings", tags=["dashboard"])

FindingTriager = Annotated[
    AuthorizationContext, Depends(require_snapshot_permission("finding:triage"))
]


@router.put("/{fingerprint}/status", status_code=status.HTTP_204_NO_CONTENT)
def set_finding_status(
    snapshot_id: uuid.UUID,
    fingerprint: Annotated[str, Path(max_length=128)],
    body: FindingStatusIn,
    db: Annotated[Session, Depends(get_db)],
    context: FindingTriager,
) -> Response:
    """Mark one finding done, or reopen it. Scores are not recalculated."""
    finding_triage.set_status(
        db,
        workspace_id=context.workspace_id,
        snapshot_id=snapshot_id,
        fingerprint=fingerprint,
        status=body.status,
        actor_user_id=context.user_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
