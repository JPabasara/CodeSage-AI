"""Add per-snapshot finding triage ("mark as done") and its permission."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260930_0025"
down_revision: str | None = "20260929_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen here rather than read from policy.json: historical migrations must not
# follow later edits to the mutable policy file.
PERMISSION = ("finding:triage", "Mark findings done or reopen them")
GRANTED_TO = ("org-admin", "manager", "developer")


def upgrade() -> None:
    op.create_table(
        "finding_triage",
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("snapshot_id", "fingerprint", name="pk_finding_triage"),
        sa.ForeignKeyConstraint(
            ["snapshot_id", "fingerprint"],
            ["finding.snapshot_id", "finding.fingerprint"],
            ondelete="CASCADE",
            name="fk_finding_triage_finding",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["app_user.id"],
            ondelete="SET NULL",
            name="fk_finding_triage_updated_by_user_id_app_user",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'done')", name="ck_finding_triage_status_value"
        ),
    )
    predicate = (
        "EXISTS (SELECT 1 FROM snapshot s "
        "JOIN analysis_attempt a ON a.id=s.analysis_attempt_id "
        "JOIN branch b ON b.id=a.branch_id "
        "JOIN repository r ON r.id=b.repository_id "
        "WHERE s.id=snapshot_id "
        "AND r.workspace_id=app_current_workspace_id())"
    )
    op.execute("ALTER TABLE finding_triage ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE finding_triage FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON finding_triage "
        f"USING ({predicate}) WITH CHECK ({predicate})"
    )

    permission_id, description = PERMISSION
    op.execute(
        sa.text("INSERT INTO permission (id, description) VALUES (:id, :description)")
        .bindparams(id=permission_id, description=description)
    )
    for role_id in GRANTED_TO:
        op.execute(
            sa.text(
                "INSERT INTO role_permission (role_id, permission_id) "
                "VALUES (:role_id, :permission_id)"
            ).bindparams(role_id=role_id, permission_id=permission_id)
        )


def downgrade() -> None:
    permission_id, _ = PERMISSION
    op.execute(
        sa.text("DELETE FROM role_permission WHERE permission_id = :id")
        .bindparams(id=permission_id)
    )
    op.execute(sa.text("DELETE FROM permission WHERE id = :id").bindparams(id=permission_id))
    op.drop_table("finding_triage")
