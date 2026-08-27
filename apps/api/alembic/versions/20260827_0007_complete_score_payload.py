"""Store the complete profile-dependent dashboard scoring result.

Revision ID: 20260827_0007
Revises: 20260827_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260827_0007"
down_revision: str | None = "20260827_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    op.add_column(
        "snapshot_score",
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    ready_constraint = next(
        (
            item["name"]
            for item in inspector.get_check_constraints("snapshot_score")
            if item["name"] and item["name"].endswith("ready_values")
        ),
        None,
    )
    if ready_constraint is not None:
        op.drop_constraint(
            op.f(ready_constraint), "snapshot_score", type_="check"
        )
    # Existing summaries cannot serve a complete dashboard. Mark them for
    # asynchronous rebuilding instead of pretending they are complete cache hits.
    op.execute(
        "UPDATE snapshot_score SET status = 'pending', "
        "started_at = NULL, completed_at = NULL, failure_information = NULL"
    )
    op.create_check_constraint(
        "ready_values",
        "snapshot_score",
        "(status = 'ready' AND health_score IS NOT NULL AND grade IS NOT NULL "
        "AND debt_score IS NOT NULL AND kloc IS NOT NULL "
        "AND result_payload IS NOT NULL) OR status <> 'ready'",
    )


def downgrade() -> None:
    op.execute("DELETE FROM snapshot_score WHERE status <> 'ready'")
    inspector = sa.inspect(op.get_bind())
    ready_constraint = next(
        (
            item["name"]
            for item in inspector.get_check_constraints("snapshot_score")
            if item["name"] and item["name"].endswith("ready_values")
        ),
        None,
    )
    if ready_constraint is not None:
        op.drop_constraint(
            op.f(ready_constraint), "snapshot_score", type_="check"
        )
    op.create_check_constraint(
        "ready_values",
        "snapshot_score",
        "(status = 'ready' AND health_score IS NOT NULL AND grade IS NOT NULL "
        "AND debt_score IS NOT NULL AND kloc IS NOT NULL) OR status <> 'ready'",
    )
    op.drop_column("snapshot_score", "result_payload")
