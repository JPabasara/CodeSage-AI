"""A finished scan's facts cannot be rewritten by the application."""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt, Branch, Repository, Snapshot

from .scans import Issue, app_session, run_scan
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture
from .test_repository_removal import (
    test_removal_cascades_through_every_repository_owned_record as _removal_cascades,
)

RESULT_TABLES = (
    "snapshot", "source_file", "code_symbol", "source_location",
    "static_metric", "process_metric", "finding", "satd_prediction",
    "bug_risk_prediction", "class_risk_prediction", "file_tree_node",
)
# A harmless assignment per table; the grant is checked before any row is read.
PROBE_COLUMN = {
    "snapshot": "finding_count = finding_count",
    "source_file": "language = language",
    "code_symbol": "name = name",
    "source_location": "start_line = start_line",
    "static_metric": "value = value",
    "process_metric": "commits_90d = commits_90d",
    "finding": "severity = severity",
    "satd_prediction": "confidence = confidence",
    "bug_risk_prediction": "risk_score = risk_score",
    "class_risk_prediction": "risk_score = risk_score",
    "file_tree_node": "name = name",
}


def _sqlstate(error: DBAPIError) -> str:
    return error.orig.sqlstate  # type: ignore[union-attr]


@pytest.fixture
def finished(tenant):
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    attempt_id = run_scan(tenant, "1" * 40)
    return tenant, attempt_id


# ── Repository revision of an attempt ─────────────────────────────────────────


@pytest.mark.parametrize(
    "assignment",
    ["commit_sha = 'f' || commit_sha", "branch_id = :other_branch",
     "analysis_engine_version_id = gen_random_uuid()"],
)
def test_attempt_identity_cannot_change(finished, assignment) -> None:
    tenant, attempt_id = finished
    with Session(tenant.engine) as db:
        other_branch = Branch(repository_id=tenant.repository_id, name="other", head_commit_sha="0")
        db.add(other_branch)
        db.commit()
        other_branch_id = other_branch.id
    # The trigger binds everyone, the table owner included, not only the app role.
    for as_app in (True, False):
        db = Session(tenant.engine)
        if as_app:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
                       {"w": str(tenant.workspace_id)})
        with pytest.raises(DBAPIError, match="analysis attempt identity is immutable"):
            db.execute(
                text(f"UPDATE analysis_attempt SET {assignment} WHERE id = :id"),
                {"id": attempt_id, "other_branch": other_branch_id},
            )
        db.rollback()
        db.close()


def test_attempt_commit_sha_cannot_change(finished) -> None:
    tenant, attempt_id = finished
    db = app_session(tenant.engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
               {"w": str(tenant.workspace_id)})
    with pytest.raises(DBAPIError) as raised:
        db.execute(
            text("UPDATE analysis_attempt SET commit_sha = :sha WHERE id = :id"),
            {"sha": "e" * 40, "id": attempt_id},
        )
    assert _sqlstate(raised.value) == "23000"
    db.rollback()
    db.close()
    with Session(tenant.engine) as db:
        assert db.get(AnalysisAttempt, attempt_id).commit_sha == "1" * 40


def test_attempt_status_can_still_advance(tenant) -> None:
    """queued -> running -> done, with times and failure fields, stays writable."""
    from .scans import queue_scan

    attempt_id = queue_scan(tenant, "2" * 40)
    db = app_session(tenant.engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
               {"w": str(tenant.workspace_id)})
    for status in ("running", "done"):
        db.execute(
            text(
                "UPDATE analysis_attempt SET status = :status, start_time = now(), "
                "completion_time = now(), failure_information = NULL, failure_code = NULL, "
                "retry_count = retry_count + 1 WHERE id = :id"
            ),
            {"status": status, "id": attempt_id},
        )
    db.commit()
    db.close()
    with Session(tenant.engine) as db:
        assert db.get(AnalysisAttempt, attempt_id).status is AnalysisStatus.DONE


def test_snapshot_commit_sha_cannot_change(finished) -> None:
    tenant, attempt_id = finished
    db = app_session(tenant.engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
               {"w": str(tenant.workspace_id)})
    with pytest.raises(DBAPIError) as raised:
        db.execute(
            text("UPDATE snapshot SET commit_sha = :sha WHERE analysis_attempt_id = :id"),
            {"sha": "e" * 40, "id": attempt_id},
        )
    assert _sqlstate(raised.value) == "42501"
    db.rollback()
    db.close()


# ── Completed results are never overwritten ───────────────────────────────────


@pytest.mark.parametrize("table", RESULT_TABLES)
def test_app_role_cannot_update_result_table(finished, table) -> None:
    tenant, _ = finished
    db = app_session(tenant.engine)
    with pytest.raises(DBAPIError) as raised:
        db.execute(text(f"UPDATE {table} SET {PROBE_COLUMN[table]}"))
    assert _sqlstate(raised.value) == "42501", table
    db.rollback()
    db.close()


def test_result_tables_grant_no_update_but_keep_delete(account) -> None:
    engine = account[0]
    with Session(engine) as db:
        for table in RESULT_TABLES:
            assert not db.scalar(
                text("SELECT has_table_privilege('codesage_app', :t, 'UPDATE')"), {"t": table}
            ), table
            for privilege in ("SELECT", "INSERT", "DELETE"):
                assert db.scalar(
                    text("SELECT has_table_privilege('codesage_app', :t, :p)"),
                    {"t": table, "p": privilege},
                ), (table, privilege)
        # The score cache is derived and is refreshed in place.
        assert db.scalar(text("SELECT has_table_privilege('codesage_app', 'snapshot_score', 'UPDATE')"))


def test_full_scan_still_finalizes(finished) -> None:
    tenant, attempt_id = finished
    with Session(tenant.engine) as db:
        attempt = db.get(AnalysisAttempt, attempt_id)
        assert attempt.status is AnalysisStatus.DONE, attempt.failure_information
        snapshot = db.scalar(select(Snapshot).where(Snapshot.analysis_attempt_id == attempt_id))
        assert snapshot is not None and snapshot.finding_count == 1


def test_repository_removal_still_cascades(account) -> None:
    _removal_cascades(account)


def test_repository_removal_after_a_real_scan_leaves_nothing(finished) -> None:
    from codesage_api.db.rls import set_workspace_context
    from codesage_api.services import repositories

    from .support import assert_no_orphans

    tenant, attempt_id = finished
    db = app_session(tenant.engine)
    set_workspace_context(db, tenant.workspace_id)
    repositories.disconnect(db, tenant.workspace_id, tenant.repository_id, tenant.user_id)
    db.commit()
    db.close()
    with Session(tenant.engine) as db:
        assert db.get(Repository, tenant.repository_id) is None
        assert db.get(AnalysisAttempt, attempt_id) is None
        assert db.scalar(text("SELECT count(*) FROM finding")) == 0
        assert_no_orphans(db.connection())


def test_every_result_table_has_a_probe() -> None:
    assert set(PROBE_COLUMN) == set(RESULT_TABLES)
