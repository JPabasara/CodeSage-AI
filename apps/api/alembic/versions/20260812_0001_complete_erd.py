"""Create the complete CodeSage ERD and tenant-isolation policies.

Revision ID: 20260812_0001
Revises:
"""

from collections.abc import Sequence
import uuid

from alembic import op
from sqlalchemy import Enum, insert
from sqlalchemy.schema import CreateIndex, CreateTable, DropTable

from codesage_api.db.base import Base
import codesage_api.db.models  # noqa: F401

revision: str = "20260812_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table below gets "you only see your own workspace's rows".
#
# `session` is deliberately NOT here. It is the table that tells us which
# workspace the caller belongs to, so it cannot be filtered by the workspace it
# has not told us yet. It holds no tenant data — only a pointer to a tenant —
# and its rows are found by an unguessable random id.
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


def upgrade() -> None:
    bind = op.get_bind()
    enum_types: dict[str, Enum] = {}
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, Enum) and column.type.name:
                enum_types[column.type.name] = column.type
    for enum_type in enum_types.values():
        enum_type.create(bind, checkfirst=True)
    for table in Base.metadata.sorted_tables:
        op.execute(CreateTable(table))
        for index in table.indexes:
            op.execute(CreateIndex(index))

    op.execute(
        "CREATE FUNCTION app_current_workspace_id() RETURNS uuid LANGUAGE sql STABLE "
        "AS $$ SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid $$"
    )

    # Sign-in has a chicken-and-egg problem: to bind a workspace we must first
    # look one up, but the MEMBERSHIP table that holds the answer is itself
    # filtered by the workspace we do not have yet.
    #
    # SECURITY DEFINER runs this function as its owner instead of as the caller,
    # so it sees past the policy. It is the ONLY thing in the system that does,
    # and it is deliberately narrow: one argument, one answer, no table exposed.
    # EXECUTE is revoked from everyone and granted only to the application role.
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
    enum_types: dict[str, Enum] = {}
    for table in reversed(Base.metadata.sorted_tables):
        for column in table.columns:
            if isinstance(column.type, Enum) and column.type.name:
                enum_types[column.type.name] = column.type
        op.execute(DropTable(table))
    for enum_type in enum_types.values():
        enum_type.drop(bind, checkfirst=True)
