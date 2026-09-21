"""Add secure workspace invitations and verified email identity metadata."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260921_0013"
down_revision: str | None = "20260921_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_user",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "workspace_invitation",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role_id", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(32), nullable=False),
        sa.Column("invited_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["role.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["app_user.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_workspace_invitation_workspace_id", "workspace_invitation", ["workspace_id"])
    op.create_index(
        "uq_workspace_invitation_pending_email",
        "workspace_invitation",
        ["workspace_id", "email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )
    op.execute("ALTER TABLE workspace_invitation ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY workspace_invitation_workspace_isolation ON workspace_invitation "
        "USING (workspace_id = app_current_workspace_id()) "
        "WITH CHECK (workspace_id = app_current_workspace_id())"
    )
    op.execute("REVOKE ALL ON TABLE workspace_invitation FROM PUBLIC")
    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE workspace_invitation TO codesage_app")

    # Acceptance occurs while the invitee's session is bound to another workspace.
    # This function is the narrow RLS escape hatch and returns no invitation data.
    op.execute(
        """
        CREATE FUNCTION app_accept_workspace_invitation(
            p_user_id uuid,
            p_token_hash bytea
        ) RETURNS TABLE(workspace_id uuid, membership_id uuid, role_id varchar)
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
            v_inv workspace_invitation%ROWTYPE;
            v_user app_user%ROWTYPE;
            v_membership_id uuid;
        BEGIN
            SELECT * INTO v_user FROM app_user WHERE id = p_user_id;
            IF NOT FOUND OR NOT v_user.email_verified OR v_user.email IS NULL THEN
                RETURN;
            END IF;

            SELECT * INTO v_inv
            FROM workspace_invitation
            WHERE token_hash = p_token_hash
              AND accepted_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > now()
            FOR UPDATE;
            IF NOT FOUND OR lower(trim(v_user.email)) <> v_inv.email THEN
                RETURN;
            END IF;

            PERFORM set_config('app.current_workspace_id', v_inv.workspace_id::text, true);

            SELECT m.id INTO v_membership_id
            FROM membership AS m
            WHERE m.user_id = p_user_id AND m.workspace_id = v_inv.workspace_id
            FOR UPDATE;
            IF FOUND THEN
                IF EXISTS (
                    SELECT 1 FROM membership AS m
                    WHERE m.id = v_membership_id AND m.status = 'active'
                ) THEN
                    RETURN;
                END IF;
                UPDATE membership AS m
                SET role_id = v_inv.role_id, status = 'active'
                WHERE m.id = v_membership_id;
            ELSE
                v_membership_id := gen_random_uuid();
                INSERT INTO membership (id, user_id, workspace_id, role_id, status)
                VALUES (v_membership_id, p_user_id, v_inv.workspace_id, v_inv.role_id, 'active');
            END IF;

            UPDATE workspace_invitation SET accepted_at = now() WHERE id = v_inv.id;
            INSERT INTO security_audit_record
                (id, workspace_id, event_type, actor_identity, affected_resource)
            VALUES
                (gen_random_uuid(), v_inv.workspace_id, 'invitation_accepted:success',
                 p_user_id::text, 'workspace_invitation:' || v_inv.id::text);
            RETURN QUERY SELECT v_inv.workspace_id, v_membership_id, v_inv.role_id;
        END $$
        """
    )
    op.execute("REVOKE EXECUTE ON FUNCTION app_accept_workspace_invitation(uuid, bytea) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION app_accept_workspace_invitation(uuid, bytea) TO codesage_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS app_accept_workspace_invitation(uuid, bytea)")
    op.drop_table("workspace_invitation")
    op.drop_column("app_user", "email_verified")
