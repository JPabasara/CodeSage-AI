
from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from codesage_api.db.models import SecurityAuditRecord
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import PermissionDenied

_SENSITIVE = ("token", "secret", "password", "authorization", "cookie")


def redact(value: Any, *, key: str = "") -> Any:
    """Recursively remove credential-shaped values before they reach storage."""
    if any(part in key.lower() for part in _SENSITIVE):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(k): redact(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


def record(
    session: Session,
    *,
    event_type: str,
    outcome: str,
    workspace_id: uuid.UUID | None = None,
    workspace_name: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: Mapping[str, Any] | None = None,
) -> None:

    actor = str(actor_user_id) if actor_user_id is not None else "anonymous"
    resource = resource_type or "system"
    if resource_id is not None:
        resource = f"{resource}:{resource_id}"
    session.add(
        SecurityAuditRecord(
            timestamp=datetime.now(UTC),
            workspace_id=workspace_id,
            workspace_name=workspace_name,
            event_type=event_type,
            outcome=outcome,
            actor_identity=actor,
            affected_resource=resource,
            detail=redact(detail) if detail else None,
        )
    )


def record_denial(session: Session, denied: PermissionDenied, *, method: str, path: str) -> None:
    """Audit a refused operation in its own transaction (DBR-30).

    The request's data transaction is rolled back with the error, so the caller
    passes a fresh session and commits it.
    """
    set_workspace_context(session, denied.workspace_id)
    record(
        session,
        event_type="operation_denied",
        outcome="denied",
        workspace_id=denied.workspace_id,
        actor_user_id=denied.user_id,
        resource_type="route",
        resource_id=f"{method} {path}",
        detail={"permission": denied.permission},
    )
