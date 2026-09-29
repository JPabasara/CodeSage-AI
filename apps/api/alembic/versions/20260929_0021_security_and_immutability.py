"""Protect immutable results, hash sessions, and normalize audit records."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260929_0021"
down_revision: str | None = "20260929_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def _replace_foreign_key(table: str, column: str, referred: str, ondelete: str) -> None:
    """Swap one column's FK action whatever the existing constraint is called.

    Databases built by 0001 use the metadata naming convention, while tables
    created by later migrations may carry PostgreSQL's default `<t>_<c>_fkey`.
    """
    op.execute(
        f"""
        DO $$
        DECLARE existing text;
        BEGIN
          SELECT c.conname INTO existing
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = '{table}'::regclass AND c.contype = 'f'
            AND a.attname = '{column}' AND cardinality(c.conkey) = 1;
          IF existing IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', '{table}', existing);
          END IF;
        END $$;
        """
    )
    op.create_foreign_key(
        f"fk_{table}_{column}_{referred}", table, referred, [column], ["id"], ondelete=ondelete
    )


RESULT_TABLES = (
    "snapshot", "source_file", "code_symbol", "source_location",
    "static_metric", "process_metric", "finding", "satd_prediction",
    "bug_risk_prediction", "class_risk_prediction", "file_tree_node",
)


def upgrade() -> None:
    # Rotating all sessions is intentional: legacy cookies expose their row id.
    op.execute("DELETE FROM session")
    op.add_column("session", sa.Column("token_hash", sa.LargeBinary(32), nullable=False))
    op.create_index("ix_session_token_hash", "session", ["token_hash"], unique=True)

    op.execute(
        """
        CREATE FUNCTION reject_attempt_identity_update() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.commit_sha IS DISTINCT FROM OLD.commit_sha
             OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
             OR NEW.analysis_engine_version_id IS DISTINCT FROM OLD.analysis_engine_version_id
          THEN
            RAISE EXCEPTION 'analysis attempt identity is immutable'
              USING ERRCODE = '23000';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER trg_analysis_attempt_identity_immutable
        BEFORE UPDATE ON analysis_attempt FOR EACH ROW
        EXECUTE FUNCTION reject_attempt_identity_update();
        """
    )
    for table in RESULT_TABLES:
        op.execute(f"REVOKE UPDATE ON {table} FROM codesage_app")

    op.add_column("security_audit_record", sa.Column("outcome", sa.String(20)))
    op.add_column("security_audit_record", sa.Column("detail", postgresql.JSONB()))
    op.add_column("security_audit_record", sa.Column("workspace_name", sa.String(255)))
    op.execute(
        """
        UPDATE security_audit_record
        SET outcome = CASE split_part(event_type, ':', 2)
          WHEN 'failure' THEN 'failure' WHEN 'denied' THEN 'denied' ELSE 'success' END,
            event_type = split_part(event_type, ':', 1)
        """
    )
    op.alter_column("security_audit_record", "outcome", nullable=False, server_default="success")
    op.create_check_constraint(
        "security_audit_outcome", "security_audit_record",
        "outcome IN ('success', 'failure', 'denied')",
    )
    op.alter_column("security_audit_record", "workspace_id", nullable=True)
    _replace_foreign_key("security_audit_record", "workspace_id", "workspace", "SET NULL")
    op.alter_column("workspace_invitation", "invited_by_user_id", nullable=True)
    _replace_foreign_key("workspace_invitation", "invited_by_user_id", "app_user", "SET NULL")
    op.execute("REVOKE UPDATE, DELETE ON security_audit_record FROM codesage_app")
    op.create_index(
        "ix_analysis_attempt_branch_done_completion",
        "analysis_attempt", ["branch_id", "completion_time"],
        postgresql_where=sa.text("status = 'done'"),
    )
    op.create_index("ix_finding_location_severity", "finding", ["source_location_id", "severity"])


def downgrade() -> None:
    op.drop_index("ix_finding_location_severity", table_name="finding")
    op.drop_index("ix_analysis_attempt_branch_done_completion", table_name="analysis_attempt")
    op.execute("GRANT UPDATE, DELETE ON security_audit_record TO codesage_app")
    _replace_foreign_key("workspace_invitation", "invited_by_user_id", "app_user", "RESTRICT")
    op.alter_column("workspace_invitation", "invited_by_user_id", nullable=False)
    _replace_foreign_key("security_audit_record", "workspace_id", "workspace", "RESTRICT")
    op.alter_column("security_audit_record", "workspace_id", nullable=False)
    op.execute(
        "UPDATE security_audit_record SET event_type = event_type || ':' || outcome"
    )
    op.drop_constraint("security_audit_outcome", "security_audit_record", type_="check")
    op.drop_column("security_audit_record", "workspace_name")
    op.drop_column("security_audit_record", "detail")
    op.drop_column("security_audit_record", "outcome")
    for table in RESULT_TABLES:
        op.execute(f"GRANT UPDATE ON {table} TO codesage_app")
    op.execute("DROP TRIGGER trg_analysis_attempt_identity_immutable ON analysis_attempt")
    op.execute("DROP FUNCTION reject_attempt_identity_update()")
    op.drop_index("ix_session_token_hash", table_name="session")
    op.drop_column("session", "token_hash")
