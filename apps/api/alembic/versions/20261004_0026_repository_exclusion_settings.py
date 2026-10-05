"""Persist repository exclusion switches and scan-time configuration."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261004_0026"
down_revision = "20260930_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "repository",
        sa.Column(
            "scan_excluded_directories",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "repository",
        sa.Column(
            "hide_excluded_findings", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "analysis_attempt", sa.Column("source_scope_config", postgresql.JSONB(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("analysis_attempt", "source_scope_config")
    op.drop_column("repository", "hide_excluded_findings")
    op.drop_column("repository", "scan_excluded_directories")
