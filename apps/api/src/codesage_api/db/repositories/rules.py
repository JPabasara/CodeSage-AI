"""Read the database-backed deterministic rule register."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import RuleDefinition


def list_definitions(session: Session) -> list[RuleDefinition]:
    """Return every rule definition in a deterministic order.

    Rule definitions are global reference data, not tenant-owned rows. Alembic
    seeds them and the worker reads them once for each scan.
    """
    statement = select(RuleDefinition).order_by(RuleDefinition.rule_id)
    return list(session.scalars(statement).all())
