from sqlalchemy import CheckConstraint, Index, UniqueConstraint
from sqlalchemy.orm import configure_mappers

import codesage_api.db.models  # noqa: F401
from codesage_api.db.base import Base

EXPECTED_TABLES = {
    "analysis_attempt",
    "analysis_engine_model_version",
    "analysis_engine_version",
    "app_user",
    "branch",
    "bug_risk_prediction",
    "code_symbol",
    "debt_category",
    "file_tree_node",
    "finding",
    "membership",
    "ml_model_version",
    "process_metric",
    "repository",
    "rule_definition",
    "satd_marker_pattern",
    "satd_prediction",
    "scoring_preset",
    "scoring_profile",
    "security_audit_record",
    "session",
    "snapshot",
    "snapshot_score",
    "source_file",
    "source_location",
    "static_metric",
    "workspace",
}


def test_all_erd_models_map() -> None:
    configure_mappers()
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_engine_model_link_has_composite_primary_key() -> None:
    table = Base.metadata.tables["analysis_engine_model_version"]
    assert {column.name for column in table.primary_key.columns} == {
        "analysis_engine_version_id",
        "model_version_id",
    }


def test_required_one_to_one_constraints_exist() -> None:
    for table_name, column_name in (
        ("snapshot", "analysis_attempt_id"),
        ("process_metric", "source_file_id"),
    ):
        table = Base.metadata.tables[table_name]
        unique_columns = {
            tuple(column.name for column in constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, UniqueConstraint)
        }
        assert (column_name,) in unique_columns


def test_probability_and_range_checks_exist() -> None:
    expected = {
        "analysis_attempt": {"ck_analysis_attempt_retry_count_nonnegative"},
        "snapshot": {"ck_snapshot_finding_count_nonnegative"},
        "satd_prediction": {"ck_satd_prediction_confidence_probability"},
        "bug_risk_prediction": {"ck_bug_risk_prediction_risk_score_probability"},
    }
    for table_name, names in expected.items():
        actual = {
            constraint.name
            for constraint in Base.metadata.tables[table_name].constraints
            if isinstance(constraint, CheckConstraint)
        }
        assert names <= actual


def test_profile_dependent_scores_are_not_persisted() -> None:
    """Authoritative scan tables do not store profile-dependent opinions."""
    forbidden_columns = {
        "finding": {"priority"},
        "source_file": {"debt_score"},
        "snapshot": {"health_score", "grade", "delta", "category_breakdown"},
    }

    for table_name, forbidden in forbidden_columns.items():
        actual = set(Base.metadata.tables[table_name].columns.keys())
        assert actual.isdisjoint(forbidden)


def test_business_keys_are_enforced_by_unique_constraints() -> None:
    expected = {
        "membership": {("user_id", "workspace_id")},
        "repository": {("workspace_id", "source_platform", "external_repository_id")},
        "branch": {("repository_id", "name")},
        "source_file": {("snapshot_id", "relative_path")},
        "ml_model_version": {("model_type", "version_identifier")},
        "bug_risk_prediction": {("source_file_id", "model_version_id")},
    }

    for table_name, required_keys in expected.items():
        actual_keys = {
            tuple(column.name for column in constraint.columns)
            for constraint in Base.metadata.tables[table_name].constraints
            if isinstance(constraint, UniqueConstraint)
        }
        assert required_keys <= actual_keys


def test_normalized_lookup_relationships_use_foreign_keys() -> None:
    expected_targets = {
        ("finding", "category_id"): "debt_category.category_id",
        ("rule_definition", "category_id"): "debt_category.category_id",
        ("satd_prediction", "category_id"): "debt_category.category_id",
        ("analysis_attempt", "analysis_engine_version_id"): "analysis_engine_version.id",
    }

    for (table_name, column_name), target in expected_targets.items():
        foreign_keys = Base.metadata.tables[table_name].columns[column_name].foreign_keys
        assert {foreign_key.target_fullname for foreign_key in foreign_keys} == {target}


def test_finding_provenance_is_exclusive() -> None:
    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in Base.metadata.tables["finding"].constraints
        if isinstance(constraint, CheckConstraint)
    }
    provenance = checks["ck_finding_provenance_consistency"]
    assert "source = 'rule'" in provenance
    assert "source = 'satd'" in provenance
    assert "rule_id IS NULL" in provenance
    assert "satd_prediction_id IS NULL" in provenance


def test_tenant_root_tables_have_workspace_foreign_keys() -> None:
    for table_name in ("membership", "repository", "scoring_profile", "security_audit_record"):
        workspace_column = Base.metadata.tables[table_name].columns["workspace_id"]
        assert {fk.target_fullname for fk in workspace_column.foreign_keys} == {"workspace.id"}


def test_single_active_profile_and_default_branch_are_unique_per_parent() -> None:
    expected_partial_indexes = {
        "scoring_profile": "uq_scoring_profile_one_active",
        "branch": "uq_branch_one_default",
    }

    for table_name, index_name in expected_partial_indexes.items():
        indexes = {
            index.name: index
            for index in Base.metadata.tables[table_name].indexes
            if isinstance(index, Index)
        }
        assert indexes[index_name].unique is True
        assert indexes[index_name].dialect_options["postgresql"]["where"] is not None
