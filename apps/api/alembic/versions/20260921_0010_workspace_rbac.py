"""Add the workspace RBAC catalogue and membership roles.

Policy values are frozen here: never import the mutable application policy.
Existing sole active members become org-admin; other memberships become viewer.
Ambiguous workspaces with multiple active members require explicit review.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260921_0010"
down_revision: str | None = "20260920_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = {
    "project:read": "View all projects in the workspace",
    "repository:read": "View connected repositories and repository details",
    "repository:connect": "Connect repositories to the workspace",
    "repository:disconnect": "Disconnect repositories from the workspace",
    "scan:start": "Start scans for repositories in the workspace",
    "scan:cancel_own": "Cancel scans started by the same user",
    "scan:cancel_any": "Cancel any running scan in the workspace",
    "result:read": "View findings and analysis results",
    "history:read": "View scan and analysis history",
    "profile:read": "View scoring profiles",
    "profile:update": "Apply/change the workspace scoring profile",
    "member:read": "View workspace members and their roles",
    "member:manage": "Invite/remove members and assign roles",
    "workspace:update": "Modify workspace settings",
}

ROLE_PERMISSIONS = {
    "org-admin": [
        "project:read",
        "repository:read",
        "repository:connect",
        "repository:disconnect",
        "scan:start",
        "scan:cancel_own",
        "scan:cancel_any",
        "result:read",
        "history:read",
        "profile:read",
        "profile:update",
        "member:read",
        "member:manage",
        "workspace:update",
    ],
    "manager": [
        "project:read",
        "repository:read",
        "repository:connect",
        "repository:disconnect",
        "scan:start",
        "scan:cancel_own",
        "scan:cancel_any",
        "result:read",
        "history:read",
        "profile:read",
        "profile:update",
        "member:read",
    ],
    "developer": [
        "project:read",
        "repository:read",
        "scan:start",
        "scan:cancel_own",
        "result:read",
        "history:read",
        "profile:read",
        "member:read",
    ],
    "viewer": [
        "project:read",
        "repository:read",
        "result:read",
        "history:read",
        "profile:read",
        "member:read",
    ],
}


def upgrade() -> None:
    # Prevent concurrent membership writes between checking and backfilling.
    op.execute("LOCK TABLE membership IN SHARE ROW EXCLUSIVE MODE")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT workspace_id FROM membership WHERE status = 'active'
                GROUP BY workspace_id HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'RBAC migration requires review: a workspace has multiple active members';
            END IF;
        END $$;
    """)
    role = op.create_table(
        "role",
        sa.Column("id", sa.String(32), primary_key=True),
    )
    permission = op.create_table(
        "permission",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("description", sa.String(255), nullable=False),
    )
    role_permission = op.create_table(
        "role_permission",
        sa.Column("role_id", sa.String(32), nullable=False),
        sa.Column("permission_id", sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["role.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permission.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_id"),
    )
    op.bulk_insert(role, [{"id": name} for name in ROLE_PERMISSIONS])
    op.bulk_insert(
        permission,
        [{"id": key, "description": description} for key, description in PERMISSIONS.items()],
    )
    op.bulk_insert(
        role_permission,
        [
            {"role_id": role_id, "permission_id": permission_id}
            for role_id, permissions in ROLE_PERMISSIONS.items()
            for permission_id in permissions
        ],
    )
    op.add_column(
        "membership", sa.Column("role_id", sa.String(32), nullable=False, server_default="viewer")
    )
    op.create_foreign_key(
        "fk_membership_role_id_role",
        "membership",
        "role",
        ["role_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute("UPDATE membership SET role_id = 'org-admin' WHERE status = 'active'")
    # The catalogue is global, contains no tenant data, and is writable only by
    # migrations. Override the bootstrap's broad default application privileges.
    for table in ("role", "permission", "role_permission"):
        op.execute(f'REVOKE ALL ON TABLE "{table}" FROM PUBLIC, codesage_app')
        op.execute(f'GRANT SELECT ON TABLE "{table}" TO codesage_app')


def downgrade() -> None:
    op.drop_constraint("fk_membership_role_id_role", "membership", type_="foreignkey")
    op.drop_column("membership", "role_id")
    op.drop_table("role_permission")
    op.drop_table("permission")
    op.drop_table("role")
