"""Add profile-stamped snapshot score cache.

Revision ID: 20260827_0005
Revises: 20260825_0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0005"
down_revision: str | None = "20260825_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The baseline migration creates Base.metadata for a brand-new database, so
    # it already includes this table. Existing installations need it added here.
    if "snapshot_score" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "snapshot_score",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("profile_fingerprint", sa.String(64), nullable=False),
        sa.Column("scoring_engine_version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("health_score", sa.Double(), nullable=True),
        sa.Column("grade", sa.String(1), nullable=True),
        sa.Column("debt_score", sa.Double(), nullable=True),
        sa.Column("kloc", sa.Double(), nullable=True),
        sa.Column("failure_information", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "health_score IS NULL OR (health_score >= 0 AND health_score <= 100)",
            name="ck_snapshot_score_health_score_range",
        ),
        sa.CheckConstraint(
            "debt_score IS NULL OR debt_score >= 0",
            name="ck_snapshot_score_debt_score_nonnegative",
        ),
        sa.CheckConstraint(
            "kloc IS NULL OR kloc >= 0",
            name="ck_snapshot_score_kloc_nonnegative",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'ready', 'error')",
            name="ck_snapshot_score_status_value",
        ),
        sa.CheckConstraint(
            "(status = 'ready' AND health_score IS NOT NULL AND grade IS NOT NULL "
            "AND debt_score IS NOT NULL AND kloc IS NOT NULL) OR status <> 'ready'",
            name="ck_snapshot_score_ready_values",
        ),
        sa.ForeignKeyConstraint(["snapshot_id"], ["snapshot.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "snapshot_id",
            "profile_fingerprint",
            "scoring_engine_version",
            name="uq_snapshot_score_inputs",
        ),
    )
    op.create_index("ix_snapshot_score_snapshot_id", "snapshot_score", ["snapshot_id"])
    predicate = (
        "EXISTS (SELECT 1 FROM snapshot s "
        "JOIN analysis_attempt a ON a.id=s.analysis_attempt_id "
        "JOIN branch b ON b.id=a.branch_id "
        "JOIN repository r ON r.id=b.repository_id "
        "WHERE s.id=snapshot_id "
        "AND r.workspace_id=app_current_workspace_id())"
    )
    op.execute("ALTER TABLE snapshot_score ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE snapshot_score FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON snapshot_score "
        f"USING ({predicate}) WITH CHECK ({predicate})"
    )


def downgrade() -> None:
    if "snapshot_score" not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.drop_index("ix_snapshot_score_snapshot_id", table_name="snapshot_score")
    op.drop_table("snapshot_score")
