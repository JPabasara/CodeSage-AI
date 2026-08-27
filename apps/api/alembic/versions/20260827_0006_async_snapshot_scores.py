"""Upgrade an existing snapshot score cache for asynchronous calculation.

Revision ID: 20260827_0006
Revises: 20260827_0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0006"
down_revision: str | None = "20260827_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add queue state without discarding summaries written before 0005 changed."""
    inspector = sa.inspect(op.get_bind())
    if "snapshot_score" not in inspector.get_table_names():
        return

    columns = {item["name"] for item in inspector.get_columns("snapshot_score")}
    added_status = "status" not in columns
    if added_status:
        # Rows produced by the old synchronous implementation are complete.
        op.add_column(
            "snapshot_score", sa.Column("status", sa.String(16), nullable=True)
        )
        op.execute("UPDATE snapshot_score SET status = 'ready'")
        op.alter_column(
            "snapshot_score",
            "status",
            nullable=False,
            server_default="pending",
        )

    for name, column_type in (
        ("failure_information", sa.Text()),
        ("started_at", sa.DateTime(timezone=True)),
        ("completed_at", sa.DateTime(timezone=True)),
    ):
        if name not in columns:
            op.add_column(
                "snapshot_score", sa.Column(name, column_type, nullable=True)
            )

    # Pending/error rows intentionally do not contain result values.
    for name, existing_type in (
        ("health_score", sa.Double()),
        ("grade", sa.String(1)),
        ("debt_score", sa.Double()),
        ("kloc", sa.Double()),
    ):
        if name in columns:
            op.alter_column(
                "snapshot_score",
                name,
                existing_type=existing_type,
                nullable=True,
            )

    checks = {
        item["name"]
        for item in inspector.get_check_constraints("snapshot_score")
        if item["name"]
    }
    # Alembic applies Base.metadata's naming convention to explicit names. An
    # older baseline therefore produced names such as
    # ``ck_snapshot_score_ck_snapshot_score_status_value`` while a later model
    # produces ``ck_snapshot_score_status_value``. The semantic suffix is the
    # stable part across both database shapes.
    if not any(name.endswith("status_value") for name in checks):
        op.create_check_constraint(
            "status_value",
            "snapshot_score",
            "status IN ('pending', 'running', 'ready', 'error')",
        )
    if not any(name.endswith("ready_values") for name in checks):
        op.create_check_constraint(
            "ready_values",
            "snapshot_score",
            "(status = 'ready' AND health_score IS NOT NULL AND grade IS NOT NULL "
            "AND debt_score IS NOT NULL AND kloc IS NOT NULL) OR status <> 'ready'",
        )


def downgrade() -> None:
    # A downgrade cannot represent pending rows in the old non-null schema.
    op.execute("DELETE FROM snapshot_score WHERE status <> 'ready'")
    inspector = sa.inspect(op.get_bind())
    checks = {
        item["name"]
        for item in inspector.get_check_constraints("snapshot_score")
        if item["name"]
    }
    for suffix in ("ready_values", "status_value"):
        constraint = next((name for name in checks if name.endswith(suffix)), None)
        if constraint is not None:
            op.drop_constraint(op.f(constraint), "snapshot_score", type_="check")
    for name, existing_type in (
        ("health_score", sa.Double()),
        ("grade", sa.String(1)),
        ("debt_score", sa.Double()),
        ("kloc", sa.Double()),
    ):
        op.alter_column(
            "snapshot_score", name, existing_type=existing_type, nullable=False
        )
    op.drop_column("snapshot_score", "completed_at")
    op.drop_column("snapshot_score", "started_at")
    op.drop_column("snapshot_score", "failure_information")
    op.drop_column("snapshot_score", "status")
