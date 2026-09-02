"""Allow bug-risk confidence to be unknown.

Revision ID: 20260902_0008
Revises: 20260827_0007
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260902_0008"
down_revision: str | None = "20260827_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("bug_risk_prediction", "confidence", nullable=True)


def downgrade() -> None:
    op.execute(
        "UPDATE bug_risk_prediction SET confidence = 1.0 WHERE confidence IS NULL"
    )
    op.alter_column("bug_risk_prediction", "confidence", nullable=False)
