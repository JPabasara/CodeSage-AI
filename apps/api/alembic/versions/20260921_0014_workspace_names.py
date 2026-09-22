"""Add workspace names to discovery and workspace administration."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260921_0014"
down_revision: str | None = "20260921_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("name", sa.String(255), nullable=False, server_default="Workspace"),
    )

def downgrade() -> None:
    op.drop_column("workspace", "name")
