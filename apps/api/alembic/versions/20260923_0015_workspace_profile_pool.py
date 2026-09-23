"""Replace the single active profile with a workspace profile pool.

Revision ID: 20260923_0015
Revises: 20260921_0014

Before this revision a workspace owned exactly one scoring profile row, rewritten
in place on every Apply, with a partial unique index standing for "at most one
active". After it a workspace owns a POOL: three immutable built-ins plus up to
five custom profiles, one of which the workspace points at as its default, and
projects may override that default individually.

The preset numbers below are frozen copies of scoring/config/presets.yaml as it
stood today. They are duplicated rather than imported on purpose: a migration
must produce the same result in a year, and the YAML is application
configuration that is free to change. Built-ins are seeded per workspace, so an
edit to the YAML later changes what NEW workspaces are seeded with and leaves
existing scores stable.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260923_0015"
down_revision: str | None = "20260921_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# key, display name, security, code-design, requirement, documentation, test, s
PRESETS: tuple[tuple[str, str, float, float, float, float, float, float], ...] = (
    ("balanced", "Balanced", 1.0, 1.0, 1.0, 1.0, 1.0, 0.5),
    ("security_first", "Security-first", 3.0, 1.0, 0.8, 0.5, 1.0, 0.5),
    ("delivery_speed", "Delivery-speed", 1.5, 1.2, 0.8, 0.5, 0.5, 0.7),
)

# Tenant tables this migration has to read and write as the migration role.
# Every one of them carries FORCE ROW LEVEL SECURITY, which applies the tenant
# policy to the table OWNER as well — and the owner has no bound workspace, so
# without lifting FORCE for the duration the seeding statements below would see
# no workspaces, insert nothing, and report success.
SEEDING_TABLES = ("workspace", "scoring_profile")

NEW_TENANT_TABLES = ("workspace_profile_settings", "repository_profile_assignment")

_PRESET_PARAMS = [
    {
        "key": key,
        "name": name,
        "security": security,
        "code_design": code_design,
        "requirement": requirement,
        "documentation": documentation,
        "test": test,
        "trust": trust,
    }
    for key, name, security, code_design, requirement, documentation, test, trust in PRESETS
]


def _preset_names() -> list[str]:
    return [name.lower() for _, name, *_rest in PRESETS]


def upgrade() -> None:
    bind = op.get_bind()

    postgresql.ENUM("built_in", "custom", name="scoring_profile_kind").create(
        bind, checkfirst=True
    )

    # ── 1. the pool columns ─────────────────────────────────────────────────
    op.add_column(
        "scoring_profile",
        sa.Column(
            "kind",
            postgresql.ENUM(name="scoring_profile_kind", create_type=False),
            nullable=False,
            server_default="custom",
        ),
    )
    op.add_column(
        "scoring_profile",
        sa.Column(
            "preset_key",
            postgresql.ENUM(name="scoring_preset_type", create_type=False),
            nullable=True,
        ),
    )
    op.add_column("scoring_profile", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))
    op.add_column("scoring_profile", sa.Column("updated_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_scoring_profile_created_by_user_id_app_user",
        "scoring_profile",
        "app_user",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_scoring_profile_updated_by_user_id_app_user",
        "scoring_profile",
        "app_user",
        ["updated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Written out rather than built with op.create_check_constraint, which
    # re-applies the "ck_%(table_name)s_%(constraint_name)s" naming convention to
    # the name it is given and would produce ck_scoring_profile_ck_scoring_...
    op.execute(
        "ALTER TABLE scoring_profile ADD CONSTRAINT ck_scoring_profile_kind_preset_key "
        "CHECK ((kind = 'built_in' AND preset_key IS NOT NULL) "
        "OR (kind = 'custom' AND preset_key IS NULL))"
    )
    # The targets of the composite foreign keys that make a cross-workspace
    # profile reference unrepresentable rather than merely refused.
    op.create_unique_constraint(
        "uq_scoring_profile_workspace_id_id", "scoring_profile", ["workspace_id", "id"]
    )
    op.create_unique_constraint(
        "uq_scoring_profile_workspace_id_preset_key",
        "scoring_profile",
        ["workspace_id", "preset_key"],
    )
    op.create_unique_constraint(
        "uq_repository_workspace_id_id", "repository", ["workspace_id", "id"]
    )

    for table in SEEDING_TABLES:
        op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')

    # ── 2. classify what is already there ───────────────────────────────────
    # Every existing row starts as a custom profile. The ones that are still
    # byte-for-byte a preset are then promoted in place, so a workspace that
    # never touched the sliders keeps the same profile id it has always had and
    # nothing downstream sees a new profile appear.
    op.execute("UPDATE scoring_profile SET kind = 'custom', preset_key = NULL")
    for preset in _PRESET_PARAMS:
        op.execute(
            sa.text(
                """
                WITH matched AS (
                    SELECT DISTINCT ON (workspace_id) id
                      FROM scoring_profile
                     WHERE preset_key IS NULL
                       AND btrim(name) = :name
                       AND security_weight = :security
                       AND code_design_weight = :code_design
                       AND requirement_weight = :requirement
                       AND documentation_weight = :documentation
                       AND test_weight = :test
                       AND trust_slider = :trust
                     ORDER BY workspace_id, is_active DESC, created_at, id
                )
                UPDATE scoring_profile AS p
                   SET kind = 'built_in', preset_key = CAST(:key AS scoring_preset_type)
                  FROM matched AS m
                 WHERE m.id = p.id
                """
            ).bindparams(**preset)
        )

    # ── 3. make room for the normalized name rule ───────────────────────────
    # Names become unique per workspace after lower()/btrim(). A leftover custom
    # row could hold a preset's name without holding its numbers, and the old
    # constraint was case-sensitive, so both kinds of clash are renamed rather
    # than dropped: no profile a team authored is discarded here.
    for preset_name in _preset_names():
        op.execute(
            sa.text(
                """
                UPDATE scoring_profile
                   SET name = left(name, 180) || ' (' || left(id::text, 8) || ')'
                 WHERE kind = 'custom'
                   AND lower(btrim(name)) = :preset_name
                """
            ).bindparams(preset_name=preset_name)
        )
    op.execute(
        """
        WITH duplicated AS (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY workspace_id, lower(btrim(name))
                    ORDER BY created_at, id
                ) AS position
                FROM scoring_profile
            ) AS ranked
            WHERE position > 1
        )
        UPDATE scoring_profile AS p
           SET name = left(p.name, 180) || ' (' || left(p.id::text, 8) || ')'
          FROM duplicated AS d
         WHERE d.id = p.id
        """
    )
    op.drop_constraint("uq_scoring_profile_workspace_id_name", "scoring_profile", type_="unique")
    op.execute(
        "CREATE UNIQUE INDEX uq_scoring_profile_workspace_name_normalized "
        "ON scoring_profile (workspace_id, lower(btrim(name)))"
    )

    # ── 4. every workspace gets all three built-ins ─────────────────────────
    for preset in _PRESET_PARAMS:
        op.execute(
            sa.text(
                """
                INSERT INTO scoring_profile (
                    id, workspace_id, kind, preset_key, name,
                    security_weight, code_design_weight, requirement_weight,
                    documentation_weight, test_weight, trust_slider
                )
                SELECT gen_random_uuid(), w.id, 'built_in',
                       CAST(:key AS scoring_preset_type), :name,
                       :security, :code_design, :requirement,
                       :documentation, :test, :trust
                  FROM workspace AS w
                 WHERE NOT EXISTS (
                     SELECT 1 FROM scoring_profile AS p
                      WHERE p.workspace_id = w.id
                        AND p.preset_key = CAST(:key AS scoring_preset_type)
                 )
                """
            ).bindparams(**preset)
        )

    # ── 5. the workspace default and the project override ───────────────────
    op.create_table(
        "workspace_profile_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("default_scoring_profile_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("workspace_id", name="pk_workspace_profile_settings"),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE",
            name="fk_workspace_profile_settings_workspace_id_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "default_scoring_profile_id"],
            ["scoring_profile.workspace_id", "scoring_profile.id"],
            # NO ACTION rather than RESTRICT: both refuse to orphan the pointer,
            # but RESTRICT fires the instant the profile row goes and would
            # abort a workspace deletion whose own cascade removes this row in
            # the same statement. NO ACTION is checked after the statement has
            # finished cascading.
            ondelete="NO ACTION",
            name="fk_workspace_profile_settings_default_scoring_profile",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["app_user.id"], ondelete="SET NULL",
            name="fk_workspace_profile_settings_updated_by_user_id_app_user",
        ),
    )
    op.create_table(
        "repository_profile_assignment",
        sa.Column("repository_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("scoring_profile_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("repository_id", name="pk_repository_profile_assignment"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "repository_id"],
            ["repository.workspace_id", "repository.id"],
            ondelete="CASCADE",
            name="fk_repository_profile_assignment_repository",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "scoring_profile_id"],
            ["scoring_profile.workspace_id", "scoring_profile.id"],
            ondelete="NO ACTION",
            name="fk_repository_profile_assignment_scoring_profile",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["app_user.id"], ondelete="SET NULL",
            name="fk_repository_profile_assignment_updated_by_user_id_app_user",
        ),
    )
    op.create_index(
        "ix_repository_profile_assignment_workspace_id",
        "repository_profile_assignment",
        ["workspace_id"],
    )
    op.create_index(
        "ix_repository_profile_assignment_scoring_profile_id",
        "repository_profile_assignment",
        ["scoring_profile_id"],
    )

    # The profile that was active becomes the default, whether it was promoted
    # to a built-in or stayed custom, so the dashboard keeps scoring with the
    # same numbers across this upgrade. A workspace that somehow had no active
    # row falls back to Balanced, which step 4 guaranteed exists.
    op.execute(
        """
        INSERT INTO workspace_profile_settings (workspace_id, default_scoring_profile_id)
        SELECT w.id,
               COALESCE(
                   (SELECT p.id FROM scoring_profile AS p
                     WHERE p.workspace_id = w.id AND p.is_active
                     ORDER BY p.id LIMIT 1),
                   (SELECT p.id FROM scoring_profile AS p
                     WHERE p.workspace_id = w.id AND p.preset_key = 'balanced')
               )
          FROM workspace AS w
        """
    )

    # ── 6. retire the old single-active design ──────────────────────────────
    # Only now, with the replacement pointer populated for every workspace.
    op.drop_index("uq_scoring_profile_one_active", table_name="scoring_profile")
    op.drop_column("scoring_profile", "is_active")

    for table in SEEDING_TABLES:
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')

    # ── 7. tenant isolation for the new tables ──────────────────────────────
    # Table privileges come from the ALTER DEFAULT PRIVILEGES in the database
    # bootstrap, the same as every other tenant table.
    predicate = "workspace_id = app_current_workspace_id()"
    for table in NEW_TENANT_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(
            f'CREATE POLICY tenant_isolation ON "{table}" '
            f"USING ({predicate}) WITH CHECK ({predicate})"
        )

    # ── 8. invariants the service cannot be trusted to remember ─────────────
    # Created last, so nothing above trips over rules about its own output.
    op.execute(
        """
        CREATE FUNCTION app_scoring_profile_built_in_guard() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.kind = 'built_in' THEN
                    RAISE EXCEPTION 'built-in scoring profiles cannot be modified'
                        USING ERRCODE = 'restrict_violation';
                END IF;
                IF NEW.kind = 'built_in' THEN
                    RAISE EXCEPTION 'a custom scoring profile cannot become a built-in'
                        USING ERRCODE = 'restrict_violation';
                END IF;
                RETURN NEW;
            END IF;

            -- DELETE. A workspace being removed takes its built-ins with it, so
            -- the guard has to tell that cascade apart from an application
            -- delete. Two independent signals, and either one permits the row to
            -- go: the workspace has already been deleted in this statement, or
            -- we are not nested inside another trigger at all. Erring towards
            -- permitting costs nothing real — no code path deletes a built-in —
            -- while erring the other way would make a workspace undeletable.
            IF OLD.kind = 'built_in'
               AND pg_trigger_depth() <= 1
               AND EXISTS (SELECT 1 FROM workspace AS w WHERE w.id = OLD.workspace_id)
            THEN
                RAISE EXCEPTION 'built-in scoring profiles cannot be deleted'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
        END $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER scoring_profile_built_in_guard
        BEFORE UPDATE OR DELETE ON scoring_profile
        FOR EACH ROW EXECUTE FUNCTION app_scoring_profile_built_in_guard()
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_scoring_profile_custom_limit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            existing integer;
        BEGIN
            IF NEW.kind <> 'custom' THEN
                RETURN NEW;
            END IF;
            -- Serialize the count for one workspace. An advisory lock rather
            -- than a row lock because every candidate row (workspace, settings)
            -- is behind row-level security, so whether the lock could be taken
            -- at all would depend on the caller's bound workspace. The count
            -- below is bounded by that same policy, and it is complete because
            -- the INSERT's own WITH CHECK already requires the current workspace
            -- to be NEW.workspace_id.
            PERFORM pg_advisory_xact_lock(
                ('x' || substr(md5('scoring_profile_custom_limit:'
                                   || NEW.workspace_id::text), 1, 16))::bit(64)::bigint
            );
            SELECT count(*) INTO existing
              FROM scoring_profile
             WHERE workspace_id = NEW.workspace_id AND kind = 'custom';
            IF existing >= 5 THEN
                RAISE EXCEPTION
                    'workspace % already holds the maximum of 5 custom scoring profiles',
                    NEW.workspace_id
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER scoring_profile_custom_limit
        BEFORE INSERT ON scoring_profile
        FOR EACH ROW EXECUTE FUNCTION app_scoring_profile_custom_limit()
        """
    )


def downgrade() -> None:
    """Collapse the pool back to one active profile per workspace.

    ⚠️ LOSSY, and unavoidably so. The old schema can hold exactly one profile per
    workspace, so going back keeps the workspace default and DELETES every other
    profile in the pool along with every project override. Custom profiles a team
    authored and any per-project selection are gone for good; the profile each
    project scored with reverts to the workspace default. Nothing else changes:
    scans, snapshots and findings are untouched, and cached scores re-derive.
    """
    op.execute("DROP TRIGGER IF EXISTS scoring_profile_custom_limit ON scoring_profile")
    op.execute("DROP TRIGGER IF EXISTS scoring_profile_built_in_guard ON scoring_profile")
    op.execute("DROP FUNCTION IF EXISTS app_scoring_profile_custom_limit()")
    op.execute("DROP FUNCTION IF EXISTS app_scoring_profile_built_in_guard()")

    # workspace_profile_settings is read below and carries FORCE too, so it joins
    # this list. It is dropped a few statements later and never gets FORCE back.
    for table in (*SEEDING_TABLES, "workspace_profile_settings"):
        op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')

    op.add_column(
        "scoring_profile",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute(
        """
        UPDATE scoring_profile AS p
           SET is_active = true
          FROM workspace_profile_settings AS s
         WHERE s.workspace_id = p.workspace_id
           AND s.default_scoring_profile_id = p.id
        """
    )
    # The DELETE below is irreversible, and everything it keeps depends on that
    # one UPDATE having seen the settings rows. A policy this migration forgot to
    # lift, or a workspace whose pointer went missing, would leave nothing marked
    # and silently empty the table. Refuse instead.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM workspace AS w
                 WHERE EXISTS (
                     SELECT 1 FROM scoring_profile AS p WHERE p.workspace_id = w.id
                 )
                   AND NOT EXISTS (
                     SELECT 1 FROM scoring_profile AS p
                      WHERE p.workspace_id = w.id AND p.is_active
                 )
            ) THEN
                RAISE EXCEPTION
                    'downgrade aborted: a workspace has profiles but no restored default, '
                    'so collapsing the pool would delete all of them';
            END IF;
        END $$;
        """
    )

    op.drop_table("repository_profile_assignment")
    op.drop_table("workspace_profile_settings")
    op.execute("DELETE FROM scoring_profile WHERE NOT is_active")

    op.execute(
        "CREATE UNIQUE INDEX uq_scoring_profile_one_active "
        "ON scoring_profile (workspace_id) WHERE is_active"
    )
    op.execute("DROP INDEX IF EXISTS uq_scoring_profile_workspace_name_normalized")
    op.drop_constraint("uq_repository_workspace_id_id", "repository", type_="unique")
    op.drop_constraint(
        "uq_scoring_profile_workspace_id_preset_key", "scoring_profile", type_="unique"
    )
    op.drop_constraint("uq_scoring_profile_workspace_id_id", "scoring_profile", type_="unique")
    op.execute("ALTER TABLE scoring_profile DROP CONSTRAINT ck_scoring_profile_kind_preset_key")
    op.drop_column("scoring_profile", "updated_by_user_id")
    op.drop_column("scoring_profile", "created_by_user_id")
    op.drop_column("scoring_profile", "preset_key")
    op.drop_column("scoring_profile", "kind")
    op.create_unique_constraint(
        "uq_scoring_profile_workspace_id_name", "scoring_profile", ["workspace_id", "name"]
    )

    for table in SEEDING_TABLES:
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')

    postgresql.ENUM(name="scoring_profile_kind").drop(op.get_bind(), checkfirst=True)
