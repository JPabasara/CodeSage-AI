"""SecurityAuditService — record security-relevant events (SAD §5.2).

Produces persistent audit records without ever storing an authentication secret.
Distinct from application logging: logs rotate and are for diagnosis, whereas
these rows are durable and are for answering "who did what, to which resource,
and did it succeed".

Events worth recording: sign-in success and failure, sign-out, repository
connected and removed, profile applied, and any denied cross-tenant access.
"""

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
    """Write one audit record.

    `actor_user_id` is nullable on purpose: a failed sign-in has no established
    actor, and that is exactly the event most worth recording.

    `detail` must never carry a token, a code or a secret — SEC-16 also applies
    here, since an audit table is read by more people than a log file.
    """
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
