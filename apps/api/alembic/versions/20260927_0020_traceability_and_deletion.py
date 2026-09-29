"""Enforce finding traceability and add safe tenant/account deletion."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260927_0020"
down_revision: str | None = "20260927_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("finding", sa.Column("snapshot_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE finding f SET snapshot_id = sf.snapshot_id
        FROM source_location sl JOIN source_file sf ON sf.id = sl.source_file_id
        WHERE sl.id = f.source_location_id
        """
    )
    # Old scans may contain duplicates (one SATD comment on several lines).
    # Keep every row and give later occurrences exactly the id that
    # detection.fingerprint.unique_in_file_order computes: repeats counted in
    # (file path, line) order, the first left untouched, the n-th replaced by
    # sha256("<fingerprint>\x1foccurrence=<n>"). Stored and read-side ids agree.
    op.execute(
        """
        WITH ranked AS (
          SELECT f.id, f.fingerprint,
                 row_number() OVER (
                   PARTITION BY f.snapshot_id, f.fingerprint
                   ORDER BY sf.relative_path, sl.start_line, f.id
                 ) - 1 AS occurrence
          FROM finding f
          JOIN source_location sl ON sl.id = f.source_location_id
          JOIN source_file sf ON sf.id = sl.source_file_id
        )
        UPDATE finding f
        SET fingerprint = encode(
          sha256(convert_to(r.fingerprint || chr(31) || 'occurrence=' || r.occurrence, 'UTF8')),
          'hex'
        )
        FROM ranked r WHERE r.id = f.id AND r.occurrence > 0
        """
    )
    op.alter_column("finding", "snapshot_id", nullable=False)
    op.create_foreign_key(
        "fk_finding_snapshot_id_snapshot", "finding", "snapshot",
        ["snapshot_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index("ix_finding_snapshot_id", "finding", ["snapshot_id"])
    op.create_unique_constraint(
        "uq_finding_snapshot_fingerprint", "finding", ["snapshot_id", "fingerprint"]
    )

    op.execute(
        "INSERT INTO permission (id, description) VALUES "
        "('workspace:delete', 'Permanently delete a workspace and its tenant data')"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_id) "
        "VALUES ('org-admin', 'workspace:delete')"
    )

    op.execute(
        """
        CREATE FUNCTION app_anonymize_user(p_session_id uuid, p_user_id uuid)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM session WHERE id=p_session_id AND user_id=p_user_id
          ) THEN RETURN false; END IF;
          IF EXISTS (
            SELECT 1 FROM membership mine
            WHERE mine.user_id=p_user_id AND mine.status='active'
              AND mine.role_id='org-admin'
              AND NOT EXISTS (
                SELECT 1 FROM membership other
                WHERE other.workspace_id=mine.workspace_id
                  AND other.user_id<>p_user_id AND other.status='active'
                  AND other.role_id='org-admin'
              )
          ) THEN RETURN false; END IF;
          UPDATE security_audit_record SET actor_identity='deleted-user'
            WHERE actor_identity=p_user_id::text;
          DELETE FROM membership WHERE user_id=p_user_id;
          DELETE FROM session WHERE user_id=p_user_id;
          UPDATE app_user SET
            asgardeo_sub='deleted:' || id::text,
            email=NULL, email_verified=false, display_name=NULL, avatar_url=NULL,
            identity_provider=NULL, github_user_id=NULL, github_username=NULL
          WHERE id=p_user_id;
          RETURN FOUND;
        END $$;
        REVOKE EXECUTE ON FUNCTION app_anonymize_user(uuid, uuid) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION app_anonymize_user(uuid, uuid) TO codesage_app;
        COMMENT ON TABLE snapshot_score IS
          'Derived, deletable cache. Historical facts live in immutable snapshot result tables.';
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION app_anonymize_user(uuid, uuid)")
    op.execute("DELETE FROM role_permission WHERE permission_id='workspace:delete'")
    op.execute("DELETE FROM permission WHERE id='workspace:delete'")
    op.drop_constraint("uq_finding_snapshot_fingerprint", "finding", type_="unique")
    op.drop_index("ix_finding_snapshot_id", table_name="finding")
    op.drop_constraint("fk_finding_snapshot_id_snapshot", "finding", type_="foreignkey")
    op.drop_column("finding", "snapshot_id")
