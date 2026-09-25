"""Create the complete CodeSage ERD and tenant-isolation policies.

Revision ID: 20260812_0001
Revises:
"""

from collections.abc import Sequence
import uuid

from alembic import op
from sqlalchemy import (
    Boolean,
    Column,
    Enum,
    Index,
    MetaData,
    Table,
    UniqueConstraint,
    insert,
    text,
)
from sqlalchemy.schema import CreateIndex, CreateTable, DropTable

from codesage_api.db.base import Base
import codesage_api.db.models  # noqa: F401

revision: str = "20260812_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DIRECT_POLICIES = {
    "workspace": "id = app_current_workspace_id()",
    "membership": "workspace_id = app_current_workspace_id()",
    "repository": "workspace_id = app_current_workspace_id()",
    "scoring_profile": "workspace_id = app_current_workspace_id()",
    "security_audit_record": "workspace_id = app_current_workspace_id()",
}

DESCENDANT_POLICIES = {
    "branch": "EXISTS (SELECT 1 FROM repository r WHERE r.id = repository_id AND r.workspace_id = app_current_workspace_id())",
    "analysis_attempt": "EXISTS (SELECT 1 FROM branch b JOIN repository r ON r.id=b.repository_id WHERE b.id=branch_id AND r.workspace_id=app_current_workspace_id())",
    "snapshot": "EXISTS (SELECT 1 FROM analysis_attempt a JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE a.id=analysis_attempt_id AND r.workspace_id=app_current_workspace_id())",
    "snapshot_score": "EXISTS (SELECT 1 FROM snapshot s JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE s.id=snapshot_id AND r.workspace_id=app_current_workspace_id())",
    "source_file": "EXISTS (SELECT 1 FROM snapshot s JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE s.id=snapshot_id AND r.workspace_id=app_current_workspace_id())",
    "file_tree_node": "EXISTS (SELECT 1 FROM snapshot s JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE s.id=snapshot_id AND r.workspace_id=app_current_workspace_id())",
    "code_symbol": "EXISTS (SELECT 1 FROM source_file sf JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sf.id=source_file_id AND r.workspace_id=app_current_workspace_id())",
    "source_location": "EXISTS (SELECT 1 FROM source_file sf JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sf.id=source_file_id AND r.workspace_id=app_current_workspace_id())",
    "static_metric": "EXISTS (SELECT 1 FROM source_file sf JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sf.id=source_file_id AND r.workspace_id=app_current_workspace_id())",
    "process_metric": "EXISTS (SELECT 1 FROM source_file sf JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sf.id=source_file_id AND r.workspace_id=app_current_workspace_id())",
    "bug_risk_prediction": "EXISTS (SELECT 1 FROM source_file sf JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sf.id=source_file_id AND r.workspace_id=app_current_workspace_id())",
    "satd_prediction": "EXISTS (SELECT 1 FROM source_location sl JOIN source_file sf ON sf.id=sl.source_file_id JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sl.id=source_location_id AND r.workspace_id=app_current_workspace_id())",
    "finding": "EXISTS (SELECT 1 FROM source_location sl JOIN source_file sf ON sf.id=sl.source_file_id JOIN snapshot s ON s.id=sf.snapshot_id JOIN analysis_attempt a ON a.id=s.analysis_attempt_id JOIN branch b ON b.id=a.branch_id JOIN repository r ON r.id=b.repository_id WHERE sl.id=source_location_id AND r.workspace_id=app_current_workspace_id())",
}


# Everything below is bookkeeping for one awkward fact: this historical
# migration builds its tables from LIVE ORM metadata, so every later schema
# change would otherwise travel backwards in time and appear at revision 0001.
# A fresh install would then reach a state no upgrade path ever produced, and an
# upgrade test could not seed the old shape it is meant to be testing.

# Tables introduced after 0001, excluded from both upgrade and downgrade.
LATER_TABLES = {
    "role",  # 0010
    "permission",  # 0010
    "role_permission",  # 0010
    "workspace_invitation",  # 0013
    "workspace_profile_settings",  # 0015
    "repository_profile_assignment",  # 0015
    "class_risk_prediction",  # 0017
}

# Columns introduced after 0001.
LATER_COLUMNS = {
    "workspace": (  # name 0014; the rest 0016
        "name",
        "description",
        "website_url",
        "created_at",
        "updated_at",
    ),
    "membership": ("role_id",),  # 0010
    "app_user": ("email_verified",),  # 0013
    "analysis_attempt": (  # 0011; failure_code 0018
        "initiated_by_user_id",
        "initiating_workspace_id",
        "failure_code",
    ),
    "finding": ("class_name", "method_name"),  # 0017
    "scoring_profile": (  # 0015
        "kind",
        "preset_key",
        "created_by_user_id",
        "updated_by_user_id",
    ),
}

# Table constraints and indexes introduced after 0001. Named explicitly rather
# than inferred from the stripped columns, because a CHECK written as text
# carries no column references to inspect.
LATER_CONSTRAINTS = {
    "scoring_profile": {  # 0015
        "ck_scoring_profile_kind_preset_key",
        "uq_scoring_profile_workspace_id_id",
        "uq_scoring_profile_workspace_id_preset_key",
    },
    "repository": {"uq_repository_workspace_id_id"},  # 0015
}
LATER_INDEXES = {
    "scoring_profile": {"uq_scoring_profile_workspace_name_normalized"},  # 0015
}


def _restore_scoring_profile_active_flag(table: Table) -> None:
    """Put back the single-active-profile design that 0015 replaced.

    Until 0015 a workspace had one mutable profile row and `is_active` said so,
    guarded by a partial unique index. Both are gone from the ORM now, so they
    have to be described here for 0001 to remain a faithful account of the
    schema 0015 upgrades FROM.
    """
    table.append_column(
        Column("is_active", Boolean, nullable=False, server_default=text("false"))
    )
    table.append_constraint(UniqueConstraint("workspace_id", "name"))
    Index(
        "uq_scoring_profile_one_active",
        table.c.workspace_id,
        unique=True,
        postgresql_where=text("is_active"),
        _table=table,
    )


def _baseline_metadata() -> MetaData:
    metadata = MetaData(naming_convention=Base.metadata.naming_convention)
    for table in Base.metadata.tables.values():
        if table.name not in LATER_TABLES:
            table.to_metadata(metadata)
    for table_name, columns in LATER_COLUMNS.items():
        table = metadata.tables[table_name]
        for name in columns:
            if name not in table.c:
                continue
            column = table.c[name]
            for fk in list(column.foreign_keys):
                table.foreign_keys.remove(fk)
                table.constraints.remove(fk.constraint)
            table._columns.remove(column)
    for table_name, names in LATER_CONSTRAINTS.items():
        table = metadata.tables[table_name]
        for constraint in list(table.constraints):
            if constraint.name in names:
                table.constraints.discard(constraint)
    for table_name, names in LATER_INDEXES.items():
        table = metadata.tables[table_name]
        for index in list(table.indexes):
            if index.name in names:
                table.indexes.discard(index)
    _restore_scoring_profile_active_flag(metadata.tables["scoring_profile"])
    # A session always had a workspace until 0016 made onboarding possible.
    metadata.tables["session"].c.workspace_id.nullable = False
    return metadata


def upgrade() -> None:
    bind = op.get_bind()
    metadata = _baseline_metadata()
    enum_types: dict[str, Enum] = {}
    for table in metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, Enum) and column.type.name:
                enum_types[column.type.name] = column.type
    for enum_type in enum_types.values():
        enum_type.create(bind, checkfirst=True)
    for table in metadata.sorted_tables:
        op.execute(CreateTable(table))
        for index in table.indexes:
            op.execute(CreateIndex(index))

    op.execute(
        "CREATE FUNCTION app_current_workspace_id() RETURNS uuid LANGUAGE sql STABLE "
        "AS $$ SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid $$"
    )

    op.execute(
        "CREATE FUNCTION app_workspace_for_user(p_user_id uuid) RETURNS uuid "
        "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp "
        "AS $$ SELECT workspace_id FROM membership "
        "WHERE user_id = p_user_id AND status = 'active' LIMIT 1 $$"
    )
    op.execute("REVOKE EXECUTE ON FUNCTION app_workspace_for_user(uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION app_workspace_for_user(uuid) TO codesage_app")
    for table_name, predicate in {**DIRECT_POLICIES, **DESCENDANT_POLICIES}.items():
        op.execute(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY')
        op.execute(
            f'CREATE POLICY tenant_isolation ON "{table_name}" '
            f"USING ({predicate}) WITH CHECK ({predicate})"
        )

    category = Base.metadata.tables["debt_category"]
    op.bulk_insert(category, [
        {"category_id": "security", "display_name": "Security"},
        {"category_id": "code-design", "display_name": "Code Design"},
        {"category_id": "requirement", "display_name": "Requirement"},
        {"category_id": "documentation", "display_name": "Documentation"},
        {"category_id": "test", "display_name": "Test"},
    ])
    marker = Base.metadata.tables["satd_marker_pattern"]
    op.bulk_insert(marker, [
        {"id": uuid.UUID("00000000-0000-0000-0000-000000000001"), "pattern": r"\b(FIXME|BUG|XXX|BROKEN|DO\s*NOT\s*(SHIP|MERGE))\b", "severity": "high", "message_template": "Self-admitted defect: '{comment_text}' - classified as {predicted_category}."},
        {"id": uuid.UUID("00000000-0000-0000-0000-000000000002"), "pattern": r"\b(TODO|HACK|TEMP|TEMPORARY|WORKAROUND|KLUDGE|REFACTOR)\b", "severity": "medium", "message_template": "Self-admitted debt: '{comment_text}' - classified as {predicted_category}."},
        {"id": uuid.UUID("00000000-0000-0000-0000-000000000003"), "pattern": r"\b(NOTE|REVIEW|NIT|IDEA|QUESTION|MAYBE)\b", "severity": "low", "message_template": "Self-admitted note: '{comment_text}' - classified as {predicted_category}."},
    ])
    rule = Base.metadata.tables["rule_definition"]
    op.bulk_insert(rule, [
        {"rule_id": "complex-function", "category_id": "code-design", "threshold": 15.0, "severity": "medium", "message_template": "{symbol}() has cyclomatic complexity {value}, over the limit of {threshold} - split it into smaller functions."},
        {"rule_id": "long-method", "category_id": "code-design", "threshold": 80.0, "severity": "medium", "message_template": "{symbol}() is {value} lines long, over the limit of {threshold} - extract cohesive blocks into helpers."},
        {"rule_id": "deep-nesting", "category_id": "code-design", "threshold": 4.0, "severity": "medium", "message_template": "{symbol}() nests {value} levels deep, over the limit of {threshold} - use early returns to flatten it."},
        {"rule_id": "large-file", "category_id": "code-design", "threshold": 800.0, "severity": "low", "message_template": "{file} is {value} lines long, over the limit of {threshold} - consider splitting it by responsibility."},
    ])


def downgrade() -> None:
    for table_name in reversed([*DIRECT_POLICIES, *DESCENDANT_POLICIES]):
        op.execute(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"')
    op.execute("DROP FUNCTION IF EXISTS app_workspace_for_user(uuid)")
    op.execute("DROP FUNCTION IF EXISTS app_current_workspace_id()")
    bind = op.get_bind()
    metadata = _baseline_metadata()
    enum_types: dict[str, Enum] = {}
    for table in reversed(metadata.sorted_tables):
        for column in table.columns:
            if isinstance(column.type, Enum) and column.type.name:
                enum_types[column.type.name] = column.type
        op.execute(DropTable(table))
    for enum_type in enum_types.values():
        enum_type.drop(bind, checkfirst=True)
