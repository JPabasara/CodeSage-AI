"""Make a workspace something the user creates, not something sign-in assumes.

Revision ID: 20260923_0017
Revises: 20260923_0016

Until now every session carried a workspace because first sign-in quietly made
one. Onboarding needs the opposite: a real, authenticated session that has
nowhere to act yet, so the web can ask the user what their workspace is called
instead of naming it for them.

Two changes follow from that. SESSION.workspace_id becomes nullable, and the
sign-in lookup has to return a workspace deterministically when the user does
have memberships — previously it took whichever row PostgreSQL happened to
return first, so a user in two workspaces could land in a different one on each
sign-in.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_0017"
down_revision: str | None = "20260923_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("session", "workspace_id", existing_type=sa.Uuid(), nullable=True)

    op.add_column("workspace", sa.Column("description", sa.String(1000), nullable=True))
    op.add_column("workspace", sa.Column("website_url", sa.String(1000), nullable=True))
    op.add_column(
        "workspace",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.add_column(
        "workspace",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Deterministic, and it prefers where the user actually was. The previous
    # definition was `LIMIT 1` with no ORDER BY, so a user belonging to two
    # workspaces could be dropped into either one on any given sign-in.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_workspace_for_user(p_user_id uuid) RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$
            SELECT m.workspace_id
              FROM membership AS m
             WHERE m.user_id = p_user_id AND m.status = 'active'
             ORDER BY (
                 SELECT max(s.last_used_at)
                   FROM session AS s
                  WHERE s.user_id = p_user_id AND s.workspace_id = m.workspace_id
             ) DESC NULLS LAST,
             m.workspace_id
             LIMIT 1
        $$
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_workspace_for_user(p_user_id uuid) RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$ SELECT workspace_id FROM membership
              WHERE user_id = p_user_id AND status = 'active' LIMIT 1 $$
        """
    )
    op.drop_column("workspace", "updated_at")
    op.drop_column("workspace", "created_at")
    op.drop_column("workspace", "website_url")
    op.drop_column("workspace", "description")

    # A session with no workspace cannot be represented by the old schema. There
    # is nothing to migrate it to, so it is deleted: the user signs in again and
    # gets a fresh one.
    op.execute("DELETE FROM session WHERE workspace_id IS NULL")
    op.alter_column("session", "workspace_id", existing_type=sa.Uuid(), nullable=False)
