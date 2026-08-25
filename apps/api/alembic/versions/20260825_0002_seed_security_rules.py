"""Seed security rules referenced by persisted findings.

Revision ID: 20260825_0002
Revises: 7dd2f16f52c8
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260825_0002"
down_revision: str | None = "7dd2f16f52c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO rule_definition
            (rule_id, category_id, threshold, severity, message_template)
        VALUES
            (
                'hardcoded-secret', 'security', 0, 'critical',
                'A credential-like value is assigned to {symbol} - move it to an environment variable and rotate the key.'
            ),
            (
                'sql-concat', 'security', 0, 'high',
                'SQL is built by string concatenation in {symbol}() - use a parameterised query.'
            )
        ON CONFLICT (rule_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM rule_definition WHERE rule_id IN ('hardcoded-secret', 'sql-concat')"
    )
