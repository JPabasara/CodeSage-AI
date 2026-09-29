"""Persist source scope and test-finding profile configuration."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260929_0024"
down_revision = "20260929_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "repository",
        sa.Column(
            "test_path_patterns",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "repository",
        sa.Column(
            "production_path_overrides",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "source_file",
        sa.Column("source_scope", sa.String(length=20), server_default="unknown", nullable=False),
    )
    op.add_column(
        "scoring_profile",
        sa.Column(
            "include_test_findings",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("scoring_profile", "include_test_findings")
    op.drop_column("source_file", "source_scope")
    op.drop_column("repository", "production_path_overrides")
    op.drop_column("repository", "test_path_patterns")
