"""Keep system-scope audit events, audit through definer functions, record failure codes.

* A failed sign-in has no workspace. The tenant policy doubled as the INSERT
  check, so `workspace_id = app_current_workspace_id()` rejected those rows and
  the event was lost. Inserts may now carry a NULL workspace; such rows are
  readable by no tenant, only by the owner (DBR-30).
* FORCE is lifted on this table alone, as 0002 did for MEMBERSHIP. The app role
  is not the owner and stays fully bound by the policy; the owner-run SECURITY
  DEFINER account-deletion function can now rewrite actor identities, which it
  silently could not while FORCE applied the tenant filter to it (DBR-28).
* Invitation acceptance writes `outcome` separately, like every other event.
* ANALYSIS_ATTEMPT gains a stable machine-readable `failure_code` (DBR-22).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0023"
down_revision: str | None = "20260929_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENANT = "workspace_id = app_current_workspace_id()"

ACCEPT_INVITATION = """
        CREATE OR REPLACE FUNCTION app_accept_workspace_invitation(
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
                (id, workspace_id, event_type, outcome, actor_identity, affected_resource)
            VALUES
                (gen_random_uuid(), v_inv.workspace_id, 'invitation_accepted', 'success',
                 p_user_id::text, 'workspace_invitation:' || v_inv.id::text);
            RETURN QUERY SELECT v_inv.workspace_id, v_membership_id, v_inv.role_id;
        END $$
"""

ACCEPT_INVITATION_0013 = """
        CREATE OR REPLACE FUNCTION app_accept_workspace_invitation(
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


def upgrade() -> None:
    op.execute("DROP POLICY tenant_isolation ON security_audit_record")
    op.execute(
        f"CREATE POLICY tenant_isolation ON security_audit_record "
        f"USING ({TENANT}) WITH CHECK (workspace_id IS NULL OR {TENANT})"
    )
    op.execute("ALTER TABLE security_audit_record NO FORCE ROW LEVEL SECURITY")
    op.execute(ACCEPT_INVITATION)
    op.add_column("analysis_attempt", sa.Column("failure_code", sa.String(64)))
    op.execute(
        "UPDATE analysis_attempt SET failure_code = 'SCAN_FAILED' "
        "WHERE status = 'error' AND failure_code IS NULL"
    )


def downgrade() -> None:
    op.drop_column("analysis_attempt", "failure_code")
    op.execute(ACCEPT_INVITATION_0013)
    op.execute("ALTER TABLE security_audit_record FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY tenant_isolation ON security_audit_record")
    op.execute(
        f"CREATE POLICY tenant_isolation ON security_audit_record "
        f"USING ({TENANT}) WITH CHECK ({TENANT})"
    )
