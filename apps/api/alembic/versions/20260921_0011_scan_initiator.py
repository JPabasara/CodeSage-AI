"""Record scan initiators without inventing ownership for historical scans."""

import sqlalchemy as sa
from alembic import op

revision = "20260921_0011"
down_revision = "20260921_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analysis_attempt", sa.Column("initiated_by_user_id", sa.Uuid(), nullable=True))
    op.add_column(
        "analysis_attempt", sa.Column("initiating_workspace_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_analysis_attempt_initiated_by_user_id_app_user",
        "analysis_attempt",
        "app_user",
        ["initiated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_analysis_attempt_initiating_workspace_id_workspace",
        "analysis_attempt",
        "workspace",
        ["initiating_workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_analysis_attempt_initiating_workspace_id_workspace",
        "analysis_attempt",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_analysis_attempt_initiated_by_user_id_app_user", "analysis_attempt", type_="foreignkey"
    )
    op.drop_column("analysis_attempt", "initiating_workspace_id")
    op.drop_column("analysis_attempt", "initiated_by_user_id")
