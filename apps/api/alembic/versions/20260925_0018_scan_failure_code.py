"""Record why a scan failed as a stable code next to its sentence (13H.1)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260925_0018"
down_revision: str | None = "20260924_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable with no backfill: historical failures keep their sentence and
    # simply have no code, which the web already treats as "unexpected".
    op.add_column(
        "analysis_attempt",
        sa.Column("failure_code", sa.String(length=40), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_attempt", "failure_code")
