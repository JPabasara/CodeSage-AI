"""Add restricted active-workspace discovery and session switching.

Membership is protected by workspace RLS, but workspace discovery happens
before a target workspace can be bound. These SECURITY DEFINER functions are
the narrow escape hatch: they expose only active memberships for one user and
allow a session switch only when the session and membership belong to that user.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260921_0012"
down_revision: str | None = "20260921_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Sign-in happens before a session exists, so this original lookup remains
    # the bootstrap path. With multiple active memberships its choice must be
    # deterministic until the user explicitly switches the new session.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_workspace_for_user(p_user_id uuid)
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT workspace_id
            FROM membership
            WHERE user_id = p_user_id AND status = 'active'
            ORDER BY workspace_id
            LIMIT 1
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_active_workspaces_for_session(
            p_session_id uuid,
            p_user_id uuid
        )
        RETURNS TABLE(workspace_id uuid, role_id varchar)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT m.workspace_id, m.role_id
            FROM membership AS m
            WHERE m.user_id = p_user_id
              AND m.status = 'active'
              AND EXISTS (
                  SELECT 1
                  FROM session AS s
                  WHERE s.id = p_session_id
                    AND s.user_id = p_user_id
                    AND s.expires_at > now()
              )
            ORDER BY m.workspace_id
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_switch_session_workspace(
            p_session_id uuid,
            p_user_id uuid,
            p_workspace_id uuid
        ) RETURNS boolean
        LANGUAGE sql VOLATILE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            WITH changed AS (
                UPDATE session AS s
                SET workspace_id = p_workspace_id
                WHERE s.id = p_session_id
                  AND s.user_id = p_user_id
                  AND s.expires_at > now()
                  AND EXISTS (
                      SELECT 1
                      FROM membership AS m
                      WHERE m.user_id = p_user_id
                        AND m.workspace_id = p_workspace_id
                        AND m.status = 'active'
                  )
                RETURNING 1
            )
            SELECT EXISTS (SELECT 1 FROM changed)
        $$
        """
    )
    for signature in (
        "app_active_workspaces_for_session(uuid, uuid)",
        "app_switch_session_workspace(uuid, uuid, uuid)",
    ):
        op.execute(f"REVOKE EXECUTE ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO codesage_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS app_switch_session_workspace(uuid, uuid, uuid)")
    op.execute("DROP FUNCTION IF EXISTS app_active_workspaces_for_session(uuid, uuid)")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_workspace_for_user(p_user_id uuid)
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT workspace_id
            FROM membership
            WHERE user_id = p_user_id AND status = 'active'
            LIMIT 1
        $$
        """
    )
