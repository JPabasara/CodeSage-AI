"""DBR-21: history is stored facts; health, grade and debt are a rebuildable cache."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from .scans import Issue, api_client, health, history, run_scan
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .support import table_checksum
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

RESULT_TABLES = [
    "analysis_attempt", "snapshot", "source_file", "code_symbol", "source_location",
    "static_metric", "process_metric", "finding", "satd_prediction",
    "bug_risk_prediction", "class_risk_prediction", "file_tree_node",
]


def _three_scans(tenant) -> None:
    for sha, issues in (
        ("1" * 40, [Issue("src/App.java", "a")]),
        ("2" * 40, [Issue("src/App.java", "a"), Issue("src/Util.java", "b")]),
        ("3" * 40, [Issue("src/Util.java", "b")]),
    ):
        tenant.world.issues = issues
        run_scan(tenant, sha)


def _facts(engine) -> dict[str, str]:
    with Session(engine) as db:
        return {table: table_checksum(db.connection(), table) for table in RESULT_TABLES}


def _views(client, tenant) -> tuple[list[dict], list[dict]]:
    rows = history(client, tenant)
    trend = health(client, tenant)["history"]
    return rows, trend


def test_scores_are_recomputed_after_cache_wipe(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    _three_scans(tenant)
    before = _views(client, tenant)

    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(*) FROM snapshot_score")) == 3
        db.execute(text("DELETE FROM snapshot_score"))
        db.commit()

    after = _views(client, tenant)
    assert after == before
    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(*) FROM snapshot_score")) == 3


def test_changing_profile_does_not_touch_snapshots(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    _three_scans(tenant)
    balanced = _views(client, tenant)
    facts = _facts(tenant.engine)

    response = client.put("/api/profiles/active", json={
        "weights": {"security": 0.1, "code_design": 3, "requirement": 1, "documentation": 1, "test": 1},
        "trust_s": 0.9,
    })
    assert response.status_code == 200, response.text
    reweighted = _views(client, tenant)

    assert _facts(tenant.engine) == facts
    # The same facts, scored anew: one cache row per snapshot per profile.
    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(DISTINCT profile_fingerprint) FROM snapshot_score")) == 2
    assert [row["commit_sha"] for row in reweighted[0]] == [row["commit_sha"] for row in balanced[0]]
    assert [row["health_score"] for row in reweighted[0]] != [row["health_score"] for row in balanced[0]]


def test_trend_spans_all_done_snapshots(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    _three_scans(tenant)
    tenant.world.fail_at["detect"] = RuntimeError("not a snapshot")
    run_scan(tenant, "4" * 40)

    rows, trend = _views(client, tenant)
    assert [point["commit_sha"] for point in trend] == ["1" * 40, "2" * 40, "3" * 40]
    assert [point["t"] for point in trend] == sorted(point["t"] for point in trend)
    # History is newest first; the trend is oldest first; both cover the same scans.
    assert [row["commit_sha"] for row in reversed(rows)] == [p["commit_sha"] for p in trend]


def test_snapshot_score_is_documented_as_a_cache(account) -> None:
    with Session(account[0]) as db:
        comment = db.scalar(text("SELECT obj_description('snapshot_score'::regclass, 'pg_class')"))
    assert comment and "cache" in comment.lower()
