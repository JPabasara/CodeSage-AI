
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import SecurityAuditRecord


def record(
    session: Session,
    *,
    event_type: str,
    outcome: str,
    workspace_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
) -> None:

    if workspace_id is None:
        return

    actor = str(actor_user_id) if actor_user_id is not None else "anonymous"
    resource = resource_type or "system"
    if resource_id is not None:
        resource = f"{resource}:{resource_id}"
    if detail:
        resource = f"{resource} ({detail})"

    session.add(
        SecurityAuditRecord(
            workspace_id=workspace_id,
            event_type=f"{event_type}:{outcome}",
            actor_identity=actor,
            affected_resource=resource,
        )
    )
