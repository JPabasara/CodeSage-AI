"""Read the database-backed deterministic rule register."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import RuleDefinition


def list_definitions(session: Session) -> list[RuleDefinition]:

    statement = select(RuleDefinition).order_by(RuleDefinition.rule_id)
    return list(session.scalars(statement).all())
