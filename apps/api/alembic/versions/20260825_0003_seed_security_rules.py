"""Align process facts and seed security rules required by scan persistence.

Revision ID: 20260825_0003
Revises: 20260825_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0003"
down_revision: str | None = "20260825_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # FR-13 stores the raw commit count used by FR-11's churn factor. Existing
    # snapshots predate that fact, so zero is the only honest, neutral backfill.
    # The initial migration currently creates tables from live ORM metadata, so
    # a fresh install may already have this column while an upgrade from main
    # still has `churn`. Converge both starting states onto the same schema.
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("process_metric")
    }
    if "commits_90d" not in columns:
        op.add_column(
            "process_metric",
            sa.Column("commits_90d", sa.Integer(), nullable=True),
        )
        op.execute("UPDATE process_metric SET commits_90d = 0")
        op.alter_column("process_metric", "commits_90d", nullable=False)
    if "churn" in columns:
        op.drop_column("process_metric", "churn")

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
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("process_metric")
    }
    if "churn" not in columns:
        op.add_column(
            "process_metric",
            sa.Column("churn", sa.Double(), nullable=True),
        )
        op.execute("UPDATE process_metric SET churn = 0")
        op.alter_column("process_metric", "churn", nullable=False)
    if "commits_90d" in columns:
        op.drop_column("process_metric", "commits_90d")
