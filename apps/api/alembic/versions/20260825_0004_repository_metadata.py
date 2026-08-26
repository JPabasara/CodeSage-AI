"""Add repository metadata required by the project contract.

Revision ID: 20260825_0004
Revises: 20260825_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0004"
down_revision: str | None = "20260825_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("repository")
    }
    if "owner" not in columns:
        op.add_column("repository", sa.Column("owner", sa.String(255), nullable=True))
        op.execute(
            "UPDATE repository SET owner = "
            "COALESCE(NULLIF(split_part(url, '/', 4), ''), 'unknown')"
        )
        op.alter_column("repository", "owner", nullable=False)
    if "created_at" not in columns:
        op.add_column(
            "repository",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )


def downgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("repository")
    }
    if "created_at" in columns:
        op.drop_column("repository", "created_at")
    if "owner" in columns:
        op.drop_column("repository", "owner")
