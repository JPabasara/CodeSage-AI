"""PostgreSQL behind the 13H.1 scan guardrails: the per-workspace running slot,
abandoned-scan expiry and the stored failure code, all as the app role under
row-level security."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
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
)
from codesage_api.db.repositories import attempts
from codesage_api.db.rls import set_workspace_context
from codesage_api.services import analysis

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414


def _seed(
    engine,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    statuses: list[tuple[AnalysisStatus, datetime | None]],
) -> list[uuid.UUID]:
    """One repository, one branch, and one attempt per (status, start_time)."""
    with Session(engine) as db:
        repository = Repository(
            workspace_id=workspace_id,
            source_platform=RepositoryPlatform.GITHUB,
            external_repository_id=str(uuid.uuid4()),
            name="guardrails",
            owner="acme",
            url="https://github.com/acme/guardrails",
            visibility=RepositoryVisibility.PUBLIC,
            connection_status=RepositoryConnectionStatus.CONNECTED,
        )
        branch = Branch(repository=repository, name="main", head_commit_sha="a" * 40, is_default=True)
        version = AnalysisEngineVersion(
            version_identifier=f"guardrails-{uuid.uuid4()}",
            tool_versions={},
            rule_set_version="v1",
            extraction_logic_version="v2",
        )
        db.add_all([repository, branch, version])
        db.flush()
        created = [
            AnalysisAttempt(
                initiated_by_user_id=user_id,
                initiating_workspace_id=workspace_id,
                branch_id=branch.id,
                analysis_engine_version_id=version.id,
                commit_sha=uuid.uuid4().hex,
                trigger_type=AnalysisTriggerType.MANUAL,
                status=status,
                start_time=started,
            )
            for status, started in statuses
        ]
        db.add_all(created)
        db.commit()
        return [attempt.id for attempt in created]


def _as_app(engine, workspace_id: uuid.UUID) -> Session:
    db = Session(engine)
    db.execute(text("SET LOCAL ROLE codesage_app"))
    set_workspace_context(db, workspace_id)
    return db


def test_the_second_scan_in_a_workspace_waits_for_the_first(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    first, second = _seed(
        engine,
        user_id,
        workspace_id,
        [(AnalysisStatus.QUEUED, None), (AnalysisStatus.QUEUED, None)],
    )

    with _as_app(engine, workspace_id) as db:
        claimed = attempts.begin_for_worker(db, workspace_id, first)
        db.commit()
    assert claimed is not None and claimed.branch_name == "main"

    with _as_app(engine, workspace_id) as db:
        with pytest.raises(attempts.WorkspaceScanSlotBusy):
            attempts.begin_for_worker(db, workspace_id, second)
        db.rollback()

    with Session(engine) as db:
        assert db.get(AnalysisAttempt, second).status is AnalysisStatus.QUEUED

    # The first one ends; the waiting one now gets the slot.
    with Session(engine) as db:
        db.get(AnalysisAttempt, first).status = AnalysisStatus.DONE
        db.commit()
    with _as_app(engine, workspace_id) as db:
        assert attempts.begin_for_worker(db, workspace_id, second) is not None
        db.commit()


def test_an_abandoned_running_scan_is_ended_and_frees_the_slot(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    long_ago = datetime.now(UTC) - timedelta(hours=1)
    recently = datetime.now(UTC) - timedelta(minutes=2)
    abandoned, live, waiting = _seed(
        engine,
        user_id,
        workspace_id,
        [
            (AnalysisStatus.RUNNING, long_ago),
            (AnalysisStatus.RUNNING, recently),
            (AnalysisStatus.QUEUED, None),
        ],
    )

    with _as_app(engine, workspace_id) as db:
        assert attempts.expire_stale_running(db, workspace_id) == 1
        db.commit()

    with Session(engine) as db:
        ended = db.get(AnalysisAttempt, abandoned)
        assert ended.status is AnalysisStatus.ERROR
        assert ended.failure_code == "SCAN_TIMED_OUT"
        assert ended.completion_time is not None
        # A scan inside its time limit is left alone.
        assert db.get(AnalysisAttempt, live).status is AnalysisStatus.RUNNING
        # Only one RUNNING remains, so the waiting one is still blocked by it.
        assert db.get(AnalysisAttempt, waiting).status is AnalysisStatus.QUEUED


def test_expiry_never_reaches_another_workspace(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    (abandoned,) = _seed(
        engine, user_id, workspace_id, [(AnalysisStatus.RUNNING, datetime(2026, 1, 1, tzinfo=UTC))]
    )

    with _as_app(engine, uuid.uuid4()) as db:
        assert attempts.expire_stale_running(db, uuid.uuid4()) == 0
        db.commit()

    with Session(engine) as db:
        assert db.get(AnalysisAttempt, abandoned).status is AnalysisStatus.RUNNING


def test_the_status_endpoint_reads_back_the_stored_code(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    (attempt_id,) = _seed(engine, user_id, workspace_id, [(AnalysisStatus.RUNNING, datetime.now(UTC))])
    with Session(engine) as db:
        attempt = db.get(AnalysisAttempt, attempt_id)
        attempt.status = AnalysisStatus.ERROR
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = "No Java files on this branch."
        attempt.failure_code = "NO_JAVA_FILES"
        repository_id = attempt.branch.repository_id
        db.commit()

    with _as_app(engine, workspace_id) as db:
        status = analysis.get_status(db, workspace_id, repository_id, attempt_id)

    assert status.error == "No Java files on this branch."
    assert status.error_code is not None and status.error_code.value == "NO_JAVA_FILES"


# ── 13H.4: "Usually about 2 min" ────────────────────────────────────────────


def test_the_typical_duration_is_the_median_of_recent_finished_scans(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    base = datetime.now(UTC) - timedelta(days=1)
    ids = _seed(
        engine,
        user_id,
        workspace_id,
        [(AnalysisStatus.DONE, base + timedelta(hours=i)) for i in range(3)]
        + [(AnalysisStatus.ERROR, base), (AnalysisStatus.QUEUED, None)],
    )
    # 60s, 120s and one slow 900s run: the median ignores the outlier. The
    # failed scan's hour-long run is not a typical scan at all.
    with Session(engine) as db:
        for attempt_id, seconds in zip(ids, [60, 120, 900, 3600], strict=False):
            attempt = db.get(AnalysisAttempt, attempt_id)
            attempt.completion_time = attempt.start_time + timedelta(seconds=seconds)
        repository_id = db.get(AnalysisAttempt, ids[0]).branch.repository_id
        db.commit()

    with _as_app(engine, workspace_id) as db:
        assert attempts.typical_duration_seconds(db, repository_id) == 120
        # And the worker hands it on with the claimed scan.
        claimed = attempts.begin_for_worker(db, workspace_id, ids[4])
        db.commit()
    assert claimed is not None and claimed.typical_seconds == 120


def test_a_repository_never_scanned_has_no_typical_duration(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    (queued,) = _seed(engine, user_id, workspace_id, [(AnalysisStatus.QUEUED, None)])
    with Session(engine) as db:
        repository_id = db.get(AnalysisAttempt, queued).branch.repository_id

    with _as_app(engine, workspace_id) as db:
        assert attempts.typical_duration_seconds(db, repository_id) is None


# ── the per-workspace queue cap ─────────────────────────────────────────────


def _empty_repository(engine, workspace_id: uuid.UUID) -> uuid.UUID:
    """A connected repository with one branch and no scans yet."""
    with Session(engine) as db:
        repository = Repository(
            workspace_id=workspace_id,
            source_platform=RepositoryPlatform.GITHUB,
            external_repository_id=str(uuid.uuid4()),
            name=f"queue-{uuid.uuid4().hex[:6]}",
            owner="acme",
            url="https://github.com/acme/queue",
            visibility=RepositoryVisibility.PUBLIC,
            connection_status=RepositoryConnectionStatus.CONNECTED,
        )
        db.add_all([repository, Branch(repository=repository, name="main", head_commit_sha="a" * 40, is_default=True)])
        db.commit()
        return repository.id


@pytest.fixture
def no_network(monkeypatch):
    from codesage_api.integrations.github import GitHubBranch
    from codesage_api.tasks.scan_pipeline import run_scan

    monkeypatch.setattr(analysis, "fetch_branch", lambda *_: GitHubBranch("main", uuid.uuid4().hex))
    monkeypatch.setattr(run_scan, "delay", lambda *_: None)


def _start(engine, workspace_id, repository_id, user_id):
    with _as_app(engine, workspace_id) as db:
        return analysis.start(db, workspace_id, repository_id, "main", actor_user_id=user_id)


def test_the_sixth_waiting_scan_in_a_workspace_is_refused(account, no_network) -> None:
    engine, _, user_id, workspace_id, _ = account
    _seed(engine, user_id, workspace_id, [(AnalysisStatus.QUEUED, None)] * 4)

    fifth = _start(engine, workspace_id, _empty_repository(engine, workspace_id), user_id)
    assert fifth.phase.value == "queued"

    from codesage_api.errors import ScanQueueFull

    with pytest.raises(ScanQueueFull):
        _start(engine, workspace_id, _empty_repository(engine, workspace_id), user_id)

    # A running scan is not waiting: once one of the queue starts, a place frees.
    with Session(engine) as db:
        waiting = db.scalars(
            select(AnalysisAttempt).where(AnalysisAttempt.status == AnalysisStatus.QUEUED)
        ).first()
        waiting.status = AnalysisStatus.RUNNING
        db.commit()
    assert _start(engine, workspace_id, _empty_repository(engine, workspace_id), user_id).phase.value == "queued"


def test_two_presses_at_once_cannot_both_take_the_last_place(
    account, no_network, monkeypatch
) -> None:
    import threading
    import time

    from codesage_api.errors import ScanQueueFull

    engine, _, user_id, workspace_id, _ = account
    # Widen the gap between "count the queue" and "add to it", so without the
    # workspace lock both presses would count four and both be queued.
    real_count = attempts.count_queued_in_workspace

    def slow_count(*args):
        counted = real_count(*args)
        time.sleep(0.5)
        return counted

    monkeypatch.setattr(analysis.attempts, "count_queued_in_workspace", slow_count)
    _seed(engine, user_id, workspace_id, [(AnalysisStatus.QUEUED, None)] * 4)
    targets = [_empty_repository(engine, workspace_id) for _ in range(2)]
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def press(repository_id: uuid.UUID) -> None:
        barrier.wait()
        try:
            _start(engine, workspace_id, repository_id, user_id)
            outcomes.append("queued")
        except ScanQueueFull:
            outcomes.append("refused")

    threads = [threading.Thread(target=press, args=(target,)) for target in targets]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(outcomes) == ["queued", "refused"]
    with Session(engine) as db:
        assert attempts.count_queued_in_workspace(db, workspace_id) == 5
