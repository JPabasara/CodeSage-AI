"""DBR-22 / REL-05: a scan commits a whole snapshot or nothing, on real PostgreSQL."""

from __future__ import annotations

import pytest
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy.orm import Session

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt
from codesage_api.tasks import cancel, scan_pipeline

from .scans import Issue, api_client, health, history, run_scan
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .support import table_row_counts
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

SNAPSHOT_TABLES = [
    "snapshot", "source_file", "source_location", "static_metric", "process_metric",
    "finding", "satd_prediction", "bug_risk_prediction", "class_risk_prediction",
    "file_tree_node", "code_symbol",
]


def _attempt(tenant, attempt_id) -> AnalysisAttempt:
    with Session(tenant.engine) as db:
        return db.get(AnalysisAttempt, attempt_id)


def _counts(tenant) -> dict[str, int]:
    with Session(tenant.engine) as db:
        return table_row_counts(db.connection(), SNAPSHOT_TABLES)


def _explode(*_args, **_kwargs):
    raise RuntimeError("database write failed mid-finalize")


@pytest.mark.parametrize("model", ["Finding", "StaticMetric", "SourceLocation"])
def test_failure_mid_finalize_leaves_no_partial_snapshot(tenant, monkeypatch, model) -> None:
    tenant.world.issues = [Issue("src/App.java", "alpha"), Issue("src/Util.java", "beta")]
    monkeypatch.setattr(scan_pipeline, model, _explode)

    attempt_id = run_scan(tenant, "1" * 40)

    assert _counts(tenant) == dict.fromkeys(SNAPSHOT_TABLES, 0)
    attempt = _attempt(tenant, attempt_id)
    assert attempt.status is AnalysisStatus.ERROR
    assert attempt.failure_information
    assert attempt.failure_code == "SCAN_FAILED"
    assert attempt.completion_time is not None


def test_failure_after_rows_were_flushed_still_rolls_back(tenant, monkeypatch) -> None:
    """The snapshot and files are already flushed when the last write fails."""
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    original = scan_pipeline.Finding
    calls = []

    def fail_on_second(*args, **kwargs):
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError("second finding failed")
        return original(*args, **kwargs)

    tenant.world.issues.append(Issue("src/Util.java", "beta"))
    monkeypatch.setattr(scan_pipeline, "Finding", fail_on_second)
    attempt_id = run_scan(tenant, "2" * 40)

    assert len(calls) == 2
    assert _counts(tenant) == dict.fromkeys(SNAPSHOT_TABLES, 0)
    assert _attempt(tenant, attempt_id).status is AnalysisStatus.ERROR


@pytest.mark.parametrize(
    ("raised", "status", "code"),
    [
        (cancel.ScanCancelled(), AnalysisStatus.CANCELLED, None),
        (SoftTimeLimitExceeded(), AnalysisStatus.ERROR, "SCAN_TIMED_OUT"),
    ],
    ids=["cancelled", "timed-out"],
)
def test_cancelled_and_timed_out_attempts_have_no_snapshot(tenant, raised, status, code) -> None:
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    tenant.world.fail_at["cancel" if status is AnalysisStatus.CANCELLED else "extract"] = raised

    attempt_id = run_scan(tenant, "3" * 40)

    attempt = _attempt(tenant, attempt_id)
    assert attempt.status is status
    assert attempt.failure_code == code
    assert (attempt.failure_information is None) is (code is None)
    assert _counts(tenant) == dict.fromkeys(SNAPSHOT_TABLES, 0)


def test_failed_attempt_is_reported_but_dashboard_ignores_it(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    good = run_scan(tenant, "4" * 40)
    before = health(client, tenant)

    tenant.world.fail_at["detect"] = RuntimeError("detector crashed")
    failed = run_scan(tenant, "5" * 40)

    status = client.get(f"/api/repos/{tenant.repository_id}/scan/{failed}")
    assert status.status_code == 200
    assert status.json()["phase"] == "error"
    assert status.json()["error"] == "The repository could not be analysed."
    assert status.json()["commit_sha"] == "5" * 40

    after = health(client, tenant)
    assert after["snapshot_id"] == before["snapshot_id"]
    assert after["commit_sha"] == "4" * 40
    rows = history(client, tenant)
    assert [row["scan_id"] for row in rows] == [str(good)]


def test_finalize_is_insert_only(tenant) -> None:
    """UPDATE is revoked on result tables, so any ORM UPDATE after an insert
    (a back-filled foreign key, say) would fail the scan. A DONE attempt with its
    rows present is the proof that finalize only inserts (DBR-23)."""
    tenant.world.issues = [Issue("src/App.java", "alpha"), Issue("src/App.java", "alpha", line=30)]
    attempt_id = run_scan(tenant, "6" * 40)
    attempt = _attempt(tenant, attempt_id)
    assert attempt.status is AnalysisStatus.DONE, attempt.failure_information
    assert _counts(tenant)["finding"] == 2
