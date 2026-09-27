"""PostgreSQL behind `GET /api/activity`: which scans and which re-scoring the
Activity menu shows, read as the app role under row-level security."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    AnalysisStatus,
    AnalysisTriggerType,
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import (
    AnalysisAttempt,
    AnalysisEngineVersion,
    Branch,
    Repository,
    Snapshot,
    SnapshotScore,
    Workspace,
)
from codesage_api.db.repositories import attempts
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.services import analysis
from codesage_api.tasks import progress

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414
from .test_scan_guardrails import _as_app

NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
def redis_progress(monkeypatch):
    """A running scan's stage comes from Redis; answer for it without one, so the
    test also shows running scans read it and queued ones do not."""
    reads: list[str] = []

    def read_status(attempt_id: str) -> progress.ProgressReading:
        reads.append(attempt_id)
        return progress.ProgressReading(
            percent=40, stage="reading_code", files_done=12, files_total=30, typical_seconds=90
        )

    monkeypatch.setattr(analysis.progress, "read_status", read_status)
    return reads


def _repository(engine, workspace_id: uuid.UUID, owner: str, name: str) -> uuid.UUID:
    """A connected repository with a default `main` branch; returns the branch id."""
    with Session(engine) as db:
        repository = Repository(
            workspace_id=workspace_id,
            source_platform=RepositoryPlatform.GITHUB,
            external_repository_id=str(uuid.uuid4()),
            name=name,
            owner=owner,
            url=f"https://github.com/{owner}/{name}",
            visibility=RepositoryVisibility.PUBLIC,
            connection_status=RepositoryConnectionStatus.CONNECTED,
        )
        branch = Branch(
            repository=repository, name="main", head_commit_sha="a" * 40, is_default=True
        )
        db.add_all([repository, branch])
        db.commit()
        return branch.id


def _attempt(
    engine,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    branch_id: uuid.UUID,
    status: AnalysisStatus,
    started: datetime | None = None,
) -> uuid.UUID:
    with Session(engine) as db:
        version = AnalysisEngineVersion(
            version_identifier=f"activity-{uuid.uuid4()}",
            tool_versions={},
            rule_set_version="v1",
            extraction_logic_version="v2",
        )
        db.add(version)
        db.flush()
        attempt = AnalysisAttempt(
            initiated_by_user_id=user_id,
            initiating_workspace_id=workspace_id,
            branch_id=branch_id,
            analysis_engine_version_id=version.id,
            commit_sha=uuid.uuid4().hex,
            trigger_type=AnalysisTriggerType.MANUAL,
            status=status,
            start_time=started,
        )
        db.add(attempt)
        db.commit()
        return attempt.id


def _snapshot(engine, user_id, workspace_id, branch_id) -> uuid.UUID:
    """A finished scan and the snapshot it produced."""
    attempt_id = _attempt(
        engine, user_id, workspace_id, branch_id, AnalysisStatus.DONE, NOW - timedelta(days=1)
    )
    with Session(engine) as db:
        attempt = db.get(AnalysisAttempt, attempt_id)
        attempt.completion_time = NOW - timedelta(days=1) + timedelta(minutes=2)
        snapshot = Snapshot(
            analysis_attempt_id=attempt_id,
            commit_sha=attempt.commit_sha,
            scan_time=NOW - timedelta(days=1),
        )
        db.add(snapshot)
        db.commit()
        return snapshot.id


def _score(
    engine,
    snapshot_id: uuid.UUID,
    status: str,
    *,
    computed_at: datetime | None = None,
    started_at: datetime | None = None,
) -> None:
    ready = status == "ready"
    with Session(engine) as db:
        db.add(
            SnapshotScore(
                snapshot_id=snapshot_id,
                profile_fingerprint=uuid.uuid4().hex,
                scoring_engine_version="v-test",
                status=status,
                started_at=started_at,
                computed_at=computed_at or NOW,
                health_score=80.0 if ready else None,
                grade="B" if ready else None,
                debt_score=1.0 if ready else None,
                kloc=1.0 if ready else None,
                result_payload={} if ready else None,
            )
        )
        db.commit()


def _foreign_workspace(engine) -> uuid.UUID:
    workspace_id = uuid.uuid4()
    with Session(engine) as db:
        db.add(Workspace(id=workspace_id, name="Elsewhere"))
        db.commit()
    return workspace_id


def _activity(engine, workspace_id: uuid.UUID) -> dict:
    with _as_app(engine, workspace_id) as db:
        result = analysis.list_activity(db, workspace_id).model_dump(mode="json")
        db.commit()
    return result


# ── scans ───────────────────────────────────────────────────────────────────


def test_queued_and_running_scans_are_listed_oldest_first(account, redis_progress) -> None:
    engine, _, user_id, workspace_id, _ = account
    zeta = _repository(engine, workspace_id, "acme", "zeta")
    alpha = _repository(engine, workspace_id, "acme", "alpha")
    first = _attempt(
        engine, user_id, workspace_id, zeta, AnalysisStatus.RUNNING, NOW - timedelta(minutes=5)
    )
    queued = _attempt(engine, user_id, workspace_id, zeta, AnalysisStatus.QUEUED)
    second = _attempt(
        engine, user_id, workspace_id, alpha, AnalysisStatus.RUNNING, NOW - timedelta(minutes=1)
    )
    for ended in (AnalysisStatus.DONE, AnalysisStatus.ERROR, AnalysisStatus.CANCELLED):
        _attempt(engine, user_id, workspace_id, alpha, ended, NOW - timedelta(minutes=3))

    activity = _activity(engine, workspace_id)

    assert [item["status"]["scan_id"] for item in activity["scans"]] == [
        str(first),
        str(second),
        str(queued),
    ]
    assert [item["repo_name"] for item in activity["scans"]] == [
        "acme/zeta",
        "acme/alpha",
        "acme/zeta",
    ]
    with Session(engine) as db:
        zeta_repo = db.get(Branch, zeta).repository_id
    assert activity["scans"][0]["repo_id"] == str(zeta_repo)

    # The same shape `GET …/scan/{scan_id}` answers.
    running = activity["scans"][0]["status"]
    assert running["phase"] == "running"
    assert running["branch"] == "main"
    assert (running["progress"], running["stage"]) == (40, "reading_code")
    assert (running["files_done"], running["files_total"], running["typical_seconds"]) == (
        12,
        30,
        90,
    )
    waiting = activity["scans"][2]["status"]
    assert waiting["phase"] == "queued"
    assert (waiting["progress"], waiting["stage"], waiting["started_at"]) == (0, None, None)
    # Only running scans ask Redis.
    assert sorted(redis_progress) == sorted([str(first), str(second)])
    assert activity["rescoring"] == []


def test_nothing_running_is_two_empty_lists(account) -> None:
    engine, _, _, workspace_id, _ = account
    assert _activity(engine, workspace_id) == {"scans": [], "rescoring": []}


def test_an_abandoned_running_scan_is_ended_before_answering(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    branch = _repository(engine, workspace_id, "acme", "guardrails")
    abandoned = _attempt(
        engine, user_id, workspace_id, branch, AnalysisStatus.RUNNING, NOW - timedelta(hours=1)
    )
    live = _attempt(
        engine, user_id, workspace_id, branch, AnalysisStatus.RUNNING, NOW - timedelta(minutes=2)
    )

    activity = _activity(engine, workspace_id)

    assert [item["status"]["scan_id"] for item in activity["scans"]] == [str(live)]
    with Session(engine) as db:
        ended = db.get(AnalysisAttempt, abandoned)
        assert ended.status is AnalysisStatus.ERROR
        assert ended.failure_code == "SCAN_TIMED_OUT"
        assert ended.completion_time is not None


# ── re-scoring ──────────────────────────────────────────────────────────────


def test_recent_pending_and_running_scores_are_counted_per_snapshot(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    beta = _repository(engine, workspace_id, "acme", "beta")
    alpha = _repository(engine, workspace_id, "acme", "alpha")
    beta_snapshots = [_snapshot(engine, user_id, workspace_id, beta) for _ in range(3)]
    alpha_snapshot = _snapshot(engine, user_id, workspace_id, alpha)

    # beta: one snapshot waiting under two profiles counts once, one running.
    _score(engine, beta_snapshots[0], "pending")
    _score(engine, beta_snapshots[0], "pending")
    # Queued long ago but picked up a minute ago: still in progress.
    _score(
        engine,
        beta_snapshots[1],
        "running",
        computed_at=NOW - timedelta(hours=2),
        started_at=NOW - timedelta(minutes=1),
    )
    # Already scored: nothing left for this one.
    _score(engine, beta_snapshots[2], "ready")
    _score(engine, alpha_snapshot, "pending")

    activity = _activity(engine, workspace_id)

    with Session(engine) as db:
        alpha_repo = db.get(Branch, alpha).repository_id
        beta_repo = db.get(Branch, beta).repository_id
    assert activity["rescoring"] == [
        {"repo_id": str(alpha_repo), "repo_name": "acme/alpha", "snapshots_left": 1},
        {"repo_id": str(beta_repo), "repo_name": "acme/beta", "snapshots_left": 2},
    ]
    assert activity["scans"] == []


def test_ready_errored_and_lost_scores_are_not_rescoring(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    branch = _repository(engine, workspace_id, "acme", "quiet")
    ready, errored, lost_pending, lost_running = (
        _snapshot(engine, user_id, workspace_id, branch) for _ in range(4)
    )
    _score(engine, ready, "ready")
    _score(engine, errored, "error")
    # A job lost more than 15 minutes ago must not show as work in progress.
    _score(engine, lost_pending, "pending", computed_at=NOW - timedelta(minutes=20))
    _score(
        engine,
        lost_running,
        "running",
        computed_at=NOW - timedelta(hours=1),
        started_at=NOW - timedelta(minutes=16),
    )

    assert _activity(engine, workspace_id)["rescoring"] == []


# ── tenancy ─────────────────────────────────────────────────────────────────


def test_another_workspace_activity_is_never_visible(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    other = _foreign_workspace(engine)
    theirs = _repository(engine, other, "rival", "secret")
    their_scan = _attempt(engine, user_id, other, theirs, AnalysisStatus.QUEUED)
    _score(engine, _snapshot(engine, user_id, other, theirs), "pending")
    ours = _repository(engine, workspace_id, "acme", "ours")
    our_scan = _attempt(engine, user_id, workspace_id, ours, AnalysisStatus.QUEUED)

    activity = _activity(engine, workspace_id)
    assert [item["status"]["scan_id"] for item in activity["scans"]] == [str(our_scan)]
    assert activity["rescoring"] == []

    # Row-level security holds even if a query asked for the other workspace.
    with _as_app(engine, workspace_id) as db:
        assert attempts.list_active_in_workspace(db, other) == []
        assert dashboard_repository.list_rescoring(db, other) == []

    # The rows exist: their own workspace sees them, and only them.
    theirs_seen = _activity(engine, other)
    assert [item["status"]["scan_id"] for item in theirs_seen["scans"]] == [str(their_scan)]
    assert [item["repo_name"] for item in theirs_seen["rescoring"]] == ["rival/secret"]
