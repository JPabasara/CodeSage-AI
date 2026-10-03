"""Finding traceability and reproducible fingerprints, end to end."""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from codesage_api.db.models import AnalysisAttempt, Finding, Snapshot

from .scans import Issue, api_client, health, history, run_scan
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

A = Issue("src/App.java", "alpha")
B = Issue("src/App.java", "beta")
C = Issue("src/Util.java", "gamma")


def _symbols(report: dict[str, object]) -> dict[str, str]:
    """Finding symbol -> change status. Symbols come from the stored reason."""
    return {
        item["reason"].split("()")[0]: item["change_status"]  # type: ignore[index]
        for item in report["findings"]  # type: ignore[union-attr]
    }


def _fingerprints(engine, attempt_id) -> set[str]:
    with Session(engine) as db:
        snapshot_id = db.scalar(select(Snapshot.id).where(Snapshot.analysis_attempt_id == attempt_id))
        return set(db.scalars(select(Finding.fingerprint).where(Finding.snapshot_id == snapshot_id)))


def test_statuses_across_two_snapshots_on_one_branch(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)

    tenant.world.issues = [A, B]
    run_scan(tenant, "1" * 40)
    first = health(client, tenant)
    assert _symbols(first) == {"alpha": "new", "beta": "new"}
    assert first["resolved_finding_count"] == 0

    tenant.world.issues = [B, C]
    run_scan(tenant, "2" * 40)
    second = health(client, tenant)
    assert _symbols(second) == {"beta": "unchanged", "gamma": "new"}
    assert second["resolved_finding_count"] == 1  # alpha

    # The older snapshot keeps the statuses it had against *its* predecessor.
    rows = history(client, tenant)
    older = health(client, tenant, snapshot_id=rows[-1]["snapshot_id"])
    assert _symbols(older) == {"alpha": "new", "beta": "new"}


def test_previous_means_latest_done_snapshot_on_the_same_branch(tenant, monkeypatch) -> None:
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    tenant.world.issues = [A]
    run_scan(tenant, "1" * 40)

    # A failed scan in between is not a snapshot and must not reset traceability.
    tenant.world.fail_at["detect"] = RuntimeError("detector crashed")
    run_scan(tenant, "2" * 40)
    tenant.world.fail_at.clear()

    tenant.world.issues = [A, B]
    run_scan(tenant, "3" * 40)
    assert _symbols(health(client, tenant)) == {"alpha": "unchanged", "beta": "new"}


def test_rescan_of_same_commit_and_engine_yields_identical_fingerprints(tenant, monkeypatch) -> None:
    """Same commit, same engine version -> same fingerprints, all unchanged."""
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)
    tenant.world.issues = [A, B, C]
    first = run_scan(tenant, "a" * 40)
    second = run_scan(tenant, "a" * 40)

    with Session(tenant.engine) as db:
        engines = set(
            db.scalars(
                select(AnalysisAttempt.analysis_engine_version_id).where(
                    AnalysisAttempt.id.in_([first, second])
                )
            )
        )
    assert len(engines) == 1
    assert _fingerprints(tenant.engine, first) == _fingerprints(tenant.engine, second)
    assert len(_fingerprints(tenant.engine, first)) == 3

    report = health(client, tenant)
    assert set(_symbols(report).values()) == {"unchanged"}
    assert report["resolved_finding_count"] == 0


def test_repeated_rule_match_is_stored_once_per_fingerprint(tenant) -> None:
    """One rule matching one symbol twice must not break the unique index."""
    twice = [Issue("src/App.java", "alpha", line=10), Issue("src/App.java", "alpha", line=40)]
    tenant.world.issues = twice
    attempt_id = run_scan(tenant, "b" * 40)

    fingerprints = _fingerprints(tenant.engine, attempt_id)
    assert len(fingerprints) == 2
    # The first occurrence keeps the detector's fingerprint, so history lines up.
    assert twice[0].detected().fingerprint in fingerprints


def test_fingerprint_is_unique_within_a_snapshot(tenant) -> None:
    tenant.world.issues = [A]
    attempt_id = run_scan(tenant, "c" * 40)
    with Session(tenant.engine) as db:
        finding = db.scalar(
            select(Finding).join(Snapshot).where(Snapshot.analysis_attempt_id == attempt_id)
        )
        with pytest.raises(IntegrityError):
            db.execute(
                text(
                    "INSERT INTO finding (id, snapshot_id, source_location_id, category_id, "
                    "rule_id, source, severity, description, fingerprint) "
                    "SELECT gen_random_uuid(), snapshot_id, source_location_id, category_id, "
                    "rule_id, source, severity, description, fingerprint "
                    "FROM finding WHERE id = :id"
                ),
                {"id": finding.id},
            )
