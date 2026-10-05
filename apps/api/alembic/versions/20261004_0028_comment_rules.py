"""Workspace comment patterns and deterministic finding provenance."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261004_0028"
down_revision = "20261004_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column(
            "comment_rules",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    # A shared detector identifier only; workspace patterns/names live in tenant settings.
    op.execute(
        sa.text(
            "INSERT INTO rule_definition (rule_id, category_id, threshold, severity, message_template) VALUES ('comment-pattern', 'documentation', 0, 'medium', 'Workspace comment rule matched.') ON CONFLICT (rule_id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_column("workspace", "comment_rules")
    # Keep provenance for existing immutable findings on downgrade.
    op.execute(
        sa.text(
            "DELETE FROM rule_definition WHERE rule_id = 'comment-pattern' AND NOT EXISTS (SELECT 1 FROM finding WHERE rule_id = 'comment-pattern')"
        )
    )
