"""Fresh database bootstrap must not create columns introduced by later revisions."""

import runpy
from pathlib import Path


def test_baseline_leaves_analysis_settings_to_their_migrations():
    migration = Path(__file__).parents[2] / "alembic/versions/20260812_0001_complete_erd.py"
    metadata = runpy.run_path(str(migration))["_baseline_metadata"]()
    assert "comment_rules" not in metadata.tables["workspace"].c
    assert "disabled_rule_ids" not in metadata.tables["workspace"].c
    assert "source_scope_config" not in metadata.tables["analysis_attempt"].c
    assert "scan_excluded_directories" not in metadata.tables["repository"].c
    assert "hide_excluded_findings" not in metadata.tables["repository"].c
