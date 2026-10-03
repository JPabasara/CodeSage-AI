"""Collaboration status of findings ("mark as done").

Triage is a label over one snapshot's immutable facts. It never changes a
score, a priority or a count, and it never carries over to a later scan: a
finding that is still detected after a fix comes back open, which is the
evidence the team needs.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from codesage_api.db.models import Finding, FindingTriage
from codesage_api.errors import NotFound, ValidationFailed
from codesage_api.scoring.enums import FindingStatus
from codesage_api.services import audit

SETTABLE_STATUSES = frozenset({FindingStatus.OPEN.value, FindingStatus.DONE.value})


def set_status(
    session: Session,
    *,
    workspace_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    fingerprint: str,
    status: str,
    actor_user_id: uuid.UUID,
) -> None:
    """Record one finding's status. The caller has already proven the snapshot
    belongs to `workspace_id`; row-level security enforces it again."""
    if status not in SETTABLE_STATUSES:
        raise ValidationFailed("Status must be open or done.")
    exists = session.scalar(
        select(Finding.id).where(
            Finding.snapshot_id == snapshot_id, Finding.fingerprint == fingerprint
        )
    )
    if exists is None:
        raise NotFound

    previous = session.scalar(
        select(FindingTriage.status).where(
            FindingTriage.snapshot_id == snapshot_id,
            FindingTriage.fingerprint == fingerprint,
        )
    ) or FindingStatus.OPEN.value
    if previous == status:
        return

    statement = insert(FindingTriage).values(
        snapshot_id=snapshot_id,
        fingerprint=fingerprint,
        status=status,
        updated_by_user_id=actor_user_id,
    )
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[FindingTriage.snapshot_id, FindingTriage.fingerprint],
            set_={
                "status": statement.excluded.status,
                "updated_by_user_id": statement.excluded.updated_by_user_id,
                "updated_at": func.now(),
            },
        )
    )
    audit.record(
        session,
        event_type="finding_status_changed",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="finding",
        resource_id=f"{snapshot_id}:{fingerprint}",
        detail={"from": previous, "to": status},
    )


def statuses_for_snapshot(session: Session, snapshot_id: uuid.UUID) -> dict[str, str]:
    """Every non-default status in one snapshot, by fingerprint."""
    rows = session.execute(
        select(FindingTriage.fingerprint, FindingTriage.status).where(
            FindingTriage.snapshot_id == snapshot_id,
            FindingTriage.status != FindingStatus.OPEN.value,
        )
    ).all()
    return {fingerprint: status for fingerprint, status in rows}
