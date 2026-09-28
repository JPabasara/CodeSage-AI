"""Persist first-run product-tour completion.

Revision ID: 20260928_0019
Revises: 20260925_0018
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0019"
down_revision: str | None = "20260925_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The temporary default marks every existing account complete. Removing it
    # immediately afterwards leaves future accounts null and eligible for the
    # guided first-run experience.
    op.add_column(
        "app_user",
        sa.Column(
            "product_tour_completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
    )
    op.alter_column("app_user", "product_tour_completed_at", server_default=None)


def downgrade() -> None:
    op.drop_column("app_user", "product_tour_completed_at")
