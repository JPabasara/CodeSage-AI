"""Dashboard reads use indexes and meet the latency targets on seeded volume.

Nightly only (`pytest -m perf`). `CODESAGE_PERF_SCALE=full` seeds the large
profile of 20 repositories x 30 snapshots x 500 files x ~20 findings; the default
"ci" scale is smaller so a local run stays short. Timings print to stdout for
the Performance Measurements report (run with `-s`).
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.db.rls import set_workspace_context
from codesage_api.integrations.github import GitHubBranch
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router
from codesage_api.services import analysis, dashboard, repositories
from codesage_api.tasks import score_cache

from .perf import (
    captured_sql,
    load_seeder,
    migrated_database,
    open_session,
    p95_seconds,
    reads_whole_payload,
    scale,
    sequential_scans,
)
from .scans import app_scope, app_session
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414

pytestmark = pytest.mark.perf

PERF_02_SECONDS = 1.0
PERF_03_SECONDS = 1.0
LARGE_TABLES = {"finding", "source_file", "analysis_attempt"}


@pytest.fixture(scope="module")
def volume(postgres_url) -> Iterator[tuple]:
    with migrated_database(postgres_url) as engine:
        seeder = load_seeder()
        with engine.begin() as db:
            [workspace] = seeder.seed(db, workspaces=1, **scale())
            # A neighbour, so row-level security has rows to filter out.
            seeder.seed(db, workspaces=1, repositories=2, snapshots=3, files=20, findings_per_file=3)
        yield engine, workspace


@pytest.fixture(scope="module")
def client(volume) -> Iterator[TestClient]:
    engine, workspace = volume
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(deps, "SessionLocal", lambda: app_session(engine))
        patch.setattr(auth_router, "SessionLocal", lambda: app_session(engine))
        patch.setattr(score_cache, "session_scope", lambda: app_scope(engine))

        def inline(name: str, args: list[object]) -> None:
            if name == "codesage.score_snapshot":
                score_cache.score_snapshot(*args)

        patch.setattr(dashboard.celery_app, "send_task", inline)
        http = TestClient(create_app())
        http.cookies.set(
            get_settings().session_cookie_name,
            open_session(engine, workspace.user_id, workspace.workspace_id),
        )
        repo = workspace.repository_ids[0]
        # Fill the score cache for every snapshot of the measured repository.
        http.get(f"/api/repos/{repo}/scans", params={"branch": "main"})
        assert len(http.get(f"/api/repos/{repo}/scans", params={"branch": "main"}).json()) == scale()["snapshots"]
        yield http


def _explain_all(engine, workspace, action) -> dict[str, list[str]]:
    """Run `action` as the app role, then EXPLAIN every SELECT it issued."""
    with captured_sql(engine) as statements:
        db = app_session(engine)
        set_workspace_context(db, workspace.workspace_id)
        action(db)
    selects = [(sql, params) for sql, params in statements if sql.lstrip().upper().startswith("SELECT") and "set_config" not in sql]
    assert selects, "the action issued no queries"
    offenders: dict[str, list[str]] = {}
    connection = db.connection()
    for sql, params in selects:
        [[plan]] = connection.exec_driver_sql("EXPLAIN (FORMAT JSON) " + sql, params).all()
        plan = plan if isinstance(plan, list) else json.loads(plan)
        if scans := sequential_scans(plan, LARGE_TABLES):
            offenders[sql.split("FROM", 1)[-1][:120]] = scans
    db.rollback()
    db.close()
    return offenders


def test_dashboard_queries_avoid_sequential_scans(volume, client) -> None:
    engine, workspace = volume
    repo = workspace.repository_ids[0]
    with Session(engine) as db:
        latest = db.scalar(
            text(
                "SELECT s.id FROM snapshot s JOIN analysis_attempt a ON a.id = s.analysis_attempt_id "
                "JOIN branch b ON b.id = a.branch_id WHERE b.repository_id = :r "
                "ORDER BY s.scan_time DESC LIMIT 1"
            ),
            {"r": repo},
        )
    ws = workspace.workspace_id
    actions = {
        "latest refs": lambda db: dashboard_repository.list_latest_completed_snapshot_refs(db, ws, repo, "main"),
        "all refs (branch)": lambda db: dashboard_repository.list_completed_snapshot_refs(db, ws, repo, "main"),
        "all refs (repo)": lambda db: dashboard_repository.list_completed_snapshot_refs(db, ws, repo, None),
        "snapshot owner": lambda db: dashboard_repository.repository_id_for_snapshot(db, ws, latest),
        "hydrate for scoring": lambda db: dashboard_repository.get_snapshot_for_scoring(db, ws, latest),
        "health report": lambda db: dashboard.build_health_report(db, ws, repo, "main"),
        "scan history": lambda db: dashboard.build_scan_history(db, ws, repo, "main"),
        "trend": lambda db: dashboard.build_trend(db, ws, repo, "main"),
        "project list": lambda db: repositories.list_projects(db, ws),
    }
    offenders = {name: found for name, action in actions.items() if (found := _explain_all(engine, workspace, action))}
    assert offenders == {}


def test_list_reads_never_fetch_score_payloads(volume, client) -> None:
    """Projects, history and trend need one score per snapshot, not its ~1 MB payload.

    Reading one key of it inside Postgres (`->>`), as the projects list does for
    `red_issue_count`, is allowed: no document travels.
    """
    engine, workspace = volume
    repo = workspace.repository_ids[0]
    ws = workspace.workspace_id
    actions = {
        "project list": lambda db: repositories.list_projects(db, ws),
        "scan history": lambda db: dashboard.build_scan_history(db, ws, repo, "main"),
        "trend": lambda db: dashboard.build_trend(db, ws, repo, "main"),
    }
    for name, action in actions.items():
        with captured_sql(engine) as statements:
            db = app_session(engine)
            set_workspace_context(db, ws)
            action(db)
            db.rollback()
            db.close()
        payload_reads = [sql for sql, _ in statements if reads_whole_payload(sql)]
        assert payload_reads == [], name


def test_health_summary_reads_one_payload(volume, client) -> None:
    """A report with many scans behind it reads the selected snapshot's payload only."""
    engine, workspace = volume
    repo = workspace.repository_ids[0]
    ws = workspace.workspace_id
    for include_findings in (False, True):
        with captured_sql(engine) as statements:
            db = app_session(engine)
            set_workspace_context(db, ws)
            dashboard.build_health_report(db, ws, repo, "main", include_findings=include_findings)
            db.rollback()
            db.close()
        payload_reads = [sql for sql, _ in statements if reads_whole_payload(sql)]
        assert len(payload_reads) == 1, payload_reads


def test_findings_are_paginated_without_changing_rank_order(volume, client) -> None:
    _, workspace = volume
    repo = workspace.repository_ids[0]
    full = client.get(f"/api/repos/{repo}/health", params={"branch": "main"}).json()
    page = client.get(
        f"/api/repos/{repo}/health/findings",
        params={"branch": "main", "limit": 3, "offset": 0},
    )
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["limit"] == 3
    assert body["offset"] == 0
    assert body["total"] == len(full["findings"])
    assert body["items"] == full["findings"][:3]


@pytest.mark.parametrize(
    ("name", "path", "params"),
    [
        ("health report (tree, findings, trend)", "/api/repos/{repo}/health", {"branch": "main"}),
        ("scan history", "/api/repos/{repo}/scans", {"branch": "main"}),
        ("older snapshot", "/api/repos/{repo}/health", {"branch": "main", "snapshot_id": "{first}"}),
        ("project list", "/api/projects", {}),
    ],
)
def test_read_endpoints_meet_perf_02(volume, client, name, path, params) -> None:
    _, workspace = volume
    repo = workspace.repository_ids[0]
    first = client.get(f"/api/repos/{repo}/scans", params={"branch": "main"}).json()[-1]["snapshot_id"]
    url = path.format(repo=repo)
    query = {key: value.format(first=first) for key, value in params.items()}

    def read() -> None:
        response = client.get(url, params=query)
        assert response.status_code == 200, response.text

    seconds = p95_seconds(read)
    print(f"{name}: p95 {seconds * 1000:.0f} ms over 20 runs ({scale()})")
    assert seconds < PERF_02_SECONDS


def test_scan_submission_meets_perf_03(volume, client, monkeypatch) -> None:
    engine, workspace = volume
    repo = workspace.repository_ids[1]
    from codesage_api.tasks.scan_pipeline import run_scan

    monkeypatch.setattr(analysis, "fetch_branch", lambda *_args: GitHubBranch("main", "e" * 40))
    monkeypatch.setattr(run_scan, "delay", lambda *_args: None)

    def submit() -> None:
        response = client.post(f"/api/repos/{repo}/scan", json={"branch": "main"})
        assert response.status_code == 202, response.text
        with engine.begin() as db:  # let the next submission start a fresh attempt
            db.execute(text("UPDATE analysis_attempt SET status = 'cancelled' WHERE status = 'queued'"))

    seconds = p95_seconds(submit)
    print(f"Scan submission: p95 {seconds * 1000:.0f} ms over 20 runs")
    assert seconds < PERF_03_SECONDS


def test_dashboard_reads_revalidate_and_follow_triage(volume, client) -> None:
    """A current copy gets 304; marking a finding done gives the report a new ETag."""
    _, workspace = volume
    repo = workspace.repository_ids[0]
    url = f"/api/repos/{repo}/health"
    first = client.get(url, params={"branch": "main"})
    assert first.status_code == 200, first.text
    etag = first.headers["etag"]

    unchanged = client.get(url, params={"branch": "main"}, headers={"If-None-Match": etag})
    assert unchanged.status_code == 304
    assert unchanged.content == b""

    finding = first.json()["findings"][0]
    marked = client.put(
        f"/api/snapshots/{first.json()['snapshot_id']}/findings/{finding['fingerprint']}/status",
        json={"status": "done"},
    )
    assert marked.status_code == 204, marked.text

    after = client.get(url, params={"branch": "main"}, headers={"If-None-Match": etag})
    assert after.status_code == 200
    assert after.headers["etag"] != etag
    statuses = {item["fingerprint"]: item["status"] for item in after.json()["findings"]}
    assert statuses[finding["fingerprint"]] == "done"
