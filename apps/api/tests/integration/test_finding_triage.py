"""Finding triage ("mark as done") against PostgreSQL, RLS and the real API."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.db.models import Membership

from .scans import Issue, api_client, app_session, health, run_scan
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .support import table_checksum
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture


def _status_url(snapshot_id: object, fingerprint: object) -> str:
    return f"/api/snapshots/{snapshot_id}/findings/{fingerprint}/status"


def _scanned(tenant, monkeypatch):
    tenant.world.issues = [Issue("src/App.java", "run"), Issue("src/Util.java", "parse")]
    run_scan(tenant, "1" * 40)
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    return client, health(client, tenant)


def _statuses(report) -> dict[str, str]:
    return {item["fingerprint"]: item["status"] for item in report["findings"]}


def test_mark_done_is_a_label_that_leaves_scores_and_facts_alone(tenant, monkeypatch) -> None:
    client, before = _scanned(tenant, monkeypatch)
    target = before["findings"][0]["fingerprint"]
    with Session(tenant.engine) as db:
        facts = table_checksum(db.connection(), "finding")

    response = client.put(_status_url(before["snapshot_id"], target), json={"status": "done"})
    assert response.status_code == 204, response.text
    after = health(client, tenant)

    assert _statuses(after)[target] == "done"
    assert all(status == "open" for fp, status in _statuses(after).items() if fp != target)
    for key in ("health_score", "grade", "red_issue_count", "category_breakdown", "file_scores"):
        assert after[key] == before[key], key
    assert [item["priority"] for item in after["findings"]] == [
        item["priority"] for item in before["findings"]
    ]
    with Session(tenant.engine) as db:
        assert table_checksum(db.connection(), "finding") == facts
        audit = db.execute(
            text(
                "SELECT outcome, actor_identity, affected_resource, detail "
                "FROM security_audit_record WHERE event_type = 'finding_status_changed'"
            )
        ).one()
    assert audit.outcome == "success"
    assert audit.actor_identity == str(tenant.user_id)
    assert audit.affected_resource == f"finding:{before['snapshot_id']}:{target}"
    assert audit.detail == {"from": "open", "to": "done"}


def test_finding_summary_follows_triage_while_every_score_stays_put(
    tenant, monkeypatch
) -> None:
    test_file = "src/test/java/AppTest.java"
    tenant.world.files = ["src/App.java", "src/Util.java", test_file]
    tenant.world.issues = [
        Issue("src/App.java", "run"),
        Issue("src/Util.java", "parse"),
        Issue(test_file, "setUp"),
    ]
    run_scan(tenant, "1" * 40)
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    before = health(client, tenant)
    scope = {item["fingerprint"]: item["source_scope"] for item in before["findings"]}
    # src/App.java is "unknown" scope: counted, like production.
    counted = [fp for fp, value in scope.items() if value != "test"]
    [in_tests] = [fp for fp, value in scope.items() if value == "test"]
    assert len(counted) == 2

    # The default view leaves the test finding out; all three are medium.
    assert before["finding_summary"] == {
        "total": 2,
        "open": 2,
        "done": 0,
        "open_by_severity": {"critical": 0, "high": 0, "medium": 2, "low": 0},
    }
    assert health(client, tenant, include_findings=False)["finding_summary"] == (
        before["finding_summary"]
    )
    assert before["java_file_count"] == 3
    assert before["kloc"] == pytest.approx(0.24)  # two production files of 120 lines

    for fingerprint in (counted[0], in_tests):
        response = client.put(
            _status_url(before["snapshot_id"], fingerprint), json={"status": "done"}
        )
        assert response.status_code == 204, response.text
    after = health(client, tenant)
    summary = health(client, tenant, include_findings=False)

    expected = {
        "total": 2,
        "open": 1,
        "done": 1,
        "open_by_severity": {"critical": 0, "high": 0, "medium": 1, "low": 0},
    }
    assert after["finding_summary"] == expected
    assert summary["finding_summary"] == expected
    unchanged = (
        "health_score", "grade", "delta", "red_issue_count", "resolved_finding_count",
        "category_breakdown", "file_scores", "tree", "history", "kloc", "java_file_count",
    )
    for key in unchanged:
        assert after[key] == before[key], key
        assert summary[key] == before[key], key


def test_reopen_and_repeat_requests_are_idempotent(tenant, monkeypatch) -> None:
    client, report = _scanned(tenant, monkeypatch)
    url = _status_url(report["snapshot_id"], report["findings"][0]["fingerprint"])

    for status in ("done", "done", "open", "open"):
        assert client.put(url, json={"status": status}).status_code == 204

    assert set(_statuses(health(client, tenant)).values()) == {"open"}
    with Session(tenant.engine) as db:
        changes = db.scalar(
            text(
                "SELECT count(*) FROM security_audit_record "
                "WHERE event_type = 'finding_status_changed'"
            )
        )
    assert changes == 2  # done, then open; the repeats changed nothing


def test_a_rescan_starts_every_finding_open(tenant, monkeypatch) -> None:
    client, first = _scanned(tenant, monkeypatch)
    target = first["findings"][0]["fingerprint"]
    assert client.put(
        _status_url(first["snapshot_id"], target), json={"status": "done"}
    ).status_code == 204

    run_scan(tenant, "2" * 40)
    latest = health(client, tenant)

    assert latest["snapshot_id"] != first["snapshot_id"]
    assert _statuses(latest)[target] == "open"
    # The earlier snapshot keeps its own label.
    assert _statuses(health(client, tenant, snapshot_id=first["snapshot_id"]))[target] == "done"


def test_viewers_cannot_triage(tenant, monkeypatch) -> None:
    client, report = _scanned(tenant, monkeypatch)
    with Session(tenant.engine) as db:
        member = db.scalar(select(Membership).where(Membership.user_id == tenant.user_id))
        member.role_id = "viewer"
        db.commit()

    response = client.put(
        _status_url(report["snapshot_id"], report["findings"][0]["fingerprint"]),
        json={"status": "done"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(*) FROM finding_triage")) == 0


def test_unknown_snapshot_and_fingerprint_are_not_found(tenant, monkeypatch) -> None:
    client, report = _scanned(tenant, monkeypatch)
    fingerprint = report["findings"][0]["fingerprint"]

    missing_snapshot = client.put(_status_url(uuid.uuid4(), fingerprint), json={"status": "done"})
    missing_finding = client.put(
        _status_url(report["snapshot_id"], "0" * 64), json={"status": "done"}
    )

    assert missing_snapshot.status_code == 404
    assert missing_finding.status_code == 404


def test_unsupported_status_is_rejected(tenant, monkeypatch) -> None:
    client, report = _scanned(tenant, monkeypatch)

    response = client.put(
        _status_url(report["snapshot_id"], report["findings"][0]["fingerprint"]),
        json={"status": "false-positive"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"


def test_triage_rows_are_invisible_to_other_workspaces(tenant, monkeypatch) -> None:
    client, report = _scanned(tenant, monkeypatch)
    assert client.put(
        _status_url(report["snapshot_id"], report["findings"][0]["fingerprint"]),
        json={"status": "done"},
    ).status_code == 204

    db = app_session(tenant.engine)
    try:
        for workspace, visible in ((tenant.workspace_id, 1), (uuid.uuid4(), 0)):
            db.execute(
                text("SELECT set_config('app.current_workspace_id', :w, true)"),
                {"w": str(workspace)},
            )
            assert db.scalar(text("SELECT count(*) FROM finding_triage")) == visible
    finally:
        db.rollback()
        db.close()
