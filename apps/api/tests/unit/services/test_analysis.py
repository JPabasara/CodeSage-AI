from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from codesage_api.db.enums import AnalysisStatus
from codesage_api.errors import NotFound, ScanQueueFull
from codesage_api.integrations.github import GitHubBranch
from codesage_api.scoring.enums import ScanErrorCode, ScanPhase, ScanStage, ScanStep
from codesage_api.services import analysis
from codesage_api.tasks import progress

# The real tidy-up, kept before the fixture below swaps it out.
_REAL_HEAL = analysis._heal
_REAL_SYNC_DEMAND = analysis._sync_demand


@pytest.fixture(autouse=True)
def plain_heal_and_no_redis():
    """Most tests replace the whole `attempts` module with a Mock, which the full
    tidy-up cannot iterate. They get its first half, ending stale running
    scans, which is what they check; the lost-queue half has its own tests."""

    def heal(session, workspace_id):
        analysis.attempts.expire_stale_running(session, workspace_id)

    with (
        patch.object(analysis, "_heal", side_effect=heal),
        patch.object(analysis, "_sync_demand"),
        patch.object(analysis.progress, "mark_waiting"),
        patch.object(analysis.progress, "clear"),
    ):
        yield


@pytest.fixture(autouse=True)
def rule_selection():
    with patch(
        "codesage_api.services.analysis.workspace_rules.disabled_rules", return_value=[]
    ) as selected, patch("codesage_api.services.analysis.workspace_rules.comment_rules", return_value=[]):
        yield selected


def _branch() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        name="main",
        head_commit_sha="old-sha",
        repository=SimpleNamespace(owner="acme", name="widget"),
    )


def _attempt(
    status: AnalysisStatus,
    commit_sha: str = "new-sha",
    *,
    failure_information: str | None = None,
    failure_code: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        source_scope_config=analysis.scan_scope_config(_branch().repository),
        commit_sha=commit_sha,
        start_time=None,
        completion_time=None,
        failure_information=failure_information,
        failure_code=failure_code,
        branch=SimpleNamespace(name="main"),
    )


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_start_creates_commits_and_enqueues_queued_attempt(
    attempt_repository: Mock,
    github_fetch: Mock,
    enqueue: Mock,
) -> None:
    session = Mock()
    branch = _branch()
    queued = _attempt(AnalysisStatus.QUEUED)
    attempt_repository.lock_repository_for_scan.return_value = SimpleNamespace()
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = None
    attempt_repository.create_queued.return_value = queued
    attempt_repository.count_queued_in_workspace.return_value = 0
    github_fetch.return_value = GitHubBranch("main", "new-sha")

    workspace_id = uuid.uuid4()
    result = analysis.start(session, workspace_id, uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    assert result.phase is ScanPhase.QUEUED
    assert result.progress == 0
    assert result.commit_sha == "new-sha"
    assert branch.head_commit_sha == "new-sha"
    session.commit.assert_called_once_with()
    enqueue.assert_called_once_with(str(queued.id), str(workspace_id))


@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_start_skips_when_latest_successful_sha_matches(
    attempt_repository: Mock,
    github_fetch: Mock,
) -> None:
    session = Mock()
    branch = _branch()
    completed = _attempt(AnalysisStatus.DONE, commit_sha="same-sha")
    completed.source_scope_config = analysis.scan_scope_config(branch.repository)
    attempt_repository.lock_repository_for_scan.return_value = SimpleNamespace()
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = completed
    github_fetch.return_value = GitHubBranch("main", "same-sha")

    result = analysis.start(
        session,
        uuid.uuid4(),
        uuid.uuid4(),
        "main",
        actor_user_id=uuid.uuid4(),
    )

    assert result.phase is ScanPhase.DONE
    assert result.progress == 100
    attempt_repository.create_queued.assert_not_called()
    session.commit.assert_not_called()


@patch("codesage_api.services.analysis.attempts")
def test_start_rejects_repository_removed_before_scan_lock(
    attempt_repository: Mock,
) -> None:
    attempt_repository.lock_repository_for_scan.return_value = None

    with pytest.raises(NotFound):
        analysis.start(
            Mock(),
            uuid.uuid4(),
            uuid.uuid4(),
            "main",
            actor_user_id=uuid.uuid4(),
        )

    attempt_repository.get_branch.assert_not_called()


@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(percent=47),
)
@patch("codesage_api.services.analysis.attempts")
def test_get_status_reads_durable_phase_and_ephemeral_progress(
    attempt_repository: Mock,
    read_status: Mock,
) -> None:
    running = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = running

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), running.id)

    assert result.phase is ScanPhase.RUNNING
    assert result.progress == 47
    read_status.assert_called_once_with(str(running.id))


@pytest.mark.parametrize(
    ("status", "expected_phase", "expected_progress"),
    [
        (AnalysisStatus.QUEUED, ScanPhase.QUEUED, 0),
        (AnalysisStatus.RUNNING, ScanPhase.RUNNING, 47),
        (AnalysisStatus.DONE, ScanPhase.DONE, 100),
        (AnalysisStatus.ERROR, ScanPhase.ERROR, 0),
        (AnalysisStatus.CANCELLED, ScanPhase.CANCELLED, 0),
    ],
)
@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(percent=47),
)
@patch("codesage_api.services.analysis.attempts")
def test_status_maps_every_database_phase(
    attempt_repository: Mock,
    _read_progress: Mock,
    status: AnalysisStatus,
    expected_phase: ScanPhase,
    expected_progress: int,
) -> None:
    attempt = _attempt(status)
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    assert result.phase is expected_phase
    assert result.progress == expected_progress


@patch("codesage_api.services.analysis.progress.request_cancel")
@patch("codesage_api.services.analysis.attempts")
def test_stop_on_a_running_scan_asks_the_worker_to_stop_at_its_next_step(
    attempt_repository: Mock,
    request_cancel: Mock,
) -> None:
    attempt = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = attempt
    attempt_repository.cancel_queued.return_value = False

    result = analysis.cancel(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    request_cancel.assert_called_once_with(str(attempt.id))
    assert result.phase is ScanPhase.RUNNING


@patch("codesage_api.services.analysis.progress.request_cancel")
@patch("codesage_api.services.analysis.attempts")
def test_stop_on_a_queued_scan_cancels_it_at_once(
    attempt_repository: Mock,
    request_cancel: Mock,
) -> None:
    """A scan that never started has no step to finish, and may have no worker
    holding it at all: waiting for one to read a flag could wait forever."""
    attempt = _attempt(AnalysisStatus.QUEUED)
    attempt_repository.get_for_repository.return_value = attempt

    def cancel_queued(_session, _workspace, attempt_id):
        assert attempt_id == attempt.id
        attempt.status = AnalysisStatus.CANCELLED
        return True

    attempt_repository.cancel_queued.side_effect = cancel_queued
    session = Mock()
    workspace_id = uuid.uuid4()

    result = analysis.cancel(session, workspace_id, uuid.uuid4(), attempt.id)

    assert result.phase is ScanPhase.CANCELLED
    request_cancel.assert_not_called()
    analysis.progress.clear.assert_called_once_with(str(attempt.id))
    analysis._sync_demand.assert_called_once_with(session, workspace_id)


@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(percent=40, cancel_requested=True),
)
@patch("codesage_api.services.analysis.attempts")
def test_a_stop_pressed_on_a_running_scan_shows_in_its_status(
    attempt_repository: Mock,
    _read_status: Mock,
) -> None:
    running = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = running

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), running.id)

    assert result.cancel_requested is True


@patch("codesage_api.services.analysis.attempts")
def test_cancel_requested_is_absent_unless_running(attempt_repository: Mock) -> None:
    queued = _attempt(AnalysisStatus.QUEUED)
    attempt_repository.get_for_repository.return_value = queued

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), queued.id)

    assert result.cancel_requested is None


# ── the tidy-up: abandoned scans end, and the autoscaler counts true ────────


def _heal_with(queued_ids, lost_ids, *, locked=True, active=0, limit=1):
    attempts = Mock()
    attempts.try_lock_workspace_slot.return_value = locked
    attempts.list_queued_in_workspace.return_value = list(queued_ids)
    attempts.expire_lost_queued.side_effect = lambda _s, _w, ids: len(ids)
    attempts.count_active_in_workspace.return_value = active
    settings = Mock(scan_queue_heartbeat_seconds=120, max_running_scans_per_workspace=limit)
    with (
        patch.object(analysis, "attempts", attempts),
        patch.object(analysis, "get_settings", return_value=settings),
        patch.object(analysis.progress, "is_lost", side_effect=lambda i, _h: i in {str(x) for x in lost_ids}),
        patch.object(analysis.progress, "sync_scan_demand") as demand,
        patch.object(analysis, "_sync_demand", _REAL_SYNC_DEMAND),
    ):
        _REAL_HEAL(Mock(), WORKSPACE)
    return attempts, demand


WORKSPACE = uuid.uuid4()


def test_a_queued_scan_no_worker_holds_is_ended() -> None:
    held, lost = uuid.uuid4(), uuid.uuid4()

    attempts, _ = _heal_with([held, lost], [lost])

    attempts.expire_stale_running.assert_called_once()
    attempts.expire_lost_queued.assert_called_once()
    assert attempts.expire_lost_queued.call_args.args[2] == [lost]
    analysis.progress.clear.assert_called_once_with(str(lost))


def test_nothing_is_ended_while_someone_else_holds_the_slot_lock() -> None:
    attempts, demand = _heal_with([uuid.uuid4()], [], locked=False)

    attempts.expire_stale_running.assert_not_called()
    attempts.expire_lost_queued.assert_not_called()
    demand.assert_not_called()


@pytest.mark.parametrize(("active", "limit", "slots"), [(0, 1, 0), (4, 1, 1), (4, 2, 2), (1, 3, 1)])
def test_a_workspace_asks_the_autoscaler_for_no_more_slots_than_it_may_run(
    active: int, limit: int, slots: int
) -> None:
    """Five scans queued in one workspace still run one at a time: asking for
    three workers would only bring up two that wait."""
    _, demand = _heal_with([], [], active=active, limit=limit)

    demand.assert_called_once_with(str(WORKSPACE), slots)


@pytest.mark.parametrize(
    "status",
    [AnalysisStatus.DONE, AnalysisStatus.ERROR, AnalysisStatus.CANCELLED],
)
@patch("codesage_api.services.analysis.progress.request_cancel")
@patch("codesage_api.services.analysis.attempts")
def test_cancel_is_idempotent_for_terminal_attempt(
    attempt_repository: Mock,
    request_cancel: Mock,
    status: AnalysisStatus,
) -> None:
    attempt = _attempt(status)
    attempt_repository.get_for_repository.return_value = attempt

    analysis.cancel(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    request_cancel.assert_not_called()


@patch("codesage_api.services.analysis.attempts")
def test_cancel_rejects_unknown_or_cross_tenant_attempt(
    attempt_repository: Mock,
) -> None:
    attempt_repository.get_for_repository.return_value = None

    with pytest.raises(NotFound):
        analysis.cancel(Mock(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4())


# ── 13H.1: why a scan failed, and scans that outlived their time limit ──────


@patch("codesage_api.services.analysis.attempts")
def test_a_guardrail_failure_reports_its_code_next_to_its_sentence(
    attempt_repository: Mock,
) -> None:
    attempt = _attempt(
        AnalysisStatus.ERROR,
        failure_information="No Java files on this branch.",
        failure_code="NO_JAVA_FILES",
    )
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    assert result.phase is ScanPhase.ERROR
    assert result.error == "No Java files on this branch."
    assert result.error_code is ScanErrorCode.NO_JAVA_FILES


@pytest.mark.parametrize(
    "status",
    [AnalysisStatus.QUEUED, AnalysisStatus.RUNNING, AnalysisStatus.DONE, AnalysisStatus.CANCELLED],
)
@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(),
)
@patch("codesage_api.services.analysis.attempts")
def test_error_code_is_absent_for_every_phase_but_error(
    attempt_repository: Mock,
    _read_progress: Mock,
    status: AnalysisStatus,
) -> None:
    # A stale code on a row that was later retried must not leak into its status.
    attempt = _attempt(status, failure_code="SCAN_TIMED_OUT")
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    assert result.error_code is None
    assert result.error is None


@pytest.mark.parametrize("stored", [None, "SOMETHING_THIS_BUILD_NEVER_HEARD_OF"])
@patch("codesage_api.services.analysis.attempts")
def test_an_unexpected_failure_has_no_code_and_never_a_500(
    attempt_repository: Mock,
    stored: str | None,
) -> None:
    attempt = _attempt(
        AnalysisStatus.ERROR,
        failure_information="The repository could not be analysed.",
        failure_code=stored,
    )
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    assert result.error == "The repository could not be analysed."
    assert result.error_code is None


@patch("codesage_api.services.analysis.attempts")
def test_status_reads_end_abandoned_scans_before_answering(
    attempt_repository: Mock,
) -> None:
    """A worker killed at the hard limit never ends its row. Every status read
    first ends such rows, so a poll converges on `error` instead of `running`
    forever."""
    calls: list[str] = []
    attempt_repository.expire_stale_running.side_effect = lambda *_: calls.append("expire")
    attempt_repository.get_for_repository.side_effect = lambda *_: (
        calls.append("read") or _attempt(AnalysisStatus.DONE)
    )
    attempt_repository.find_active_for_repository.side_effect = lambda *_: (
        calls.append("read") or None
    )
    session = Mock()
    workspace_id = uuid.uuid4()

    analysis.get_status(session, workspace_id, uuid.uuid4(), uuid.uuid4())
    analysis.get_active(session, workspace_id, uuid.uuid4(), None)

    assert calls == ["expire", "read", "expire", "read"]
    attempt_repository.expire_stale_running.assert_called_with(session, workspace_id)


@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_start_ends_abandoned_scans_before_the_already_running_check(
    attempt_repository: Mock,
    github_fetch: Mock,
) -> None:
    calls: list[str] = []
    attempt_repository.lock_repository_for_scan.return_value = SimpleNamespace()
    attempt_repository.get_branch.return_value = _branch()
    attempt_repository.expire_stale_running.side_effect = lambda *_: calls.append("expire")
    attempt_repository.find_active_for_branch.side_effect = lambda *_: (
        calls.append("active?") or None
    )
    attempt_repository.find_latest_completed.return_value = _attempt(
        AnalysisStatus.DONE, commit_sha="same-sha"
    )
    github_fetch.return_value = GitHubBranch("main", "same-sha")

    analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    assert calls == ["expire", "active?"]


@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(
        percent=31,
        stage="reading_code",
        files_done=120,
        files_total=1240,
        typical_seconds=130,
    ),
)
@patch("codesage_api.services.analysis.attempts")
def test_a_running_scan_reports_its_stage_file_counts_and_typical_duration(
    attempt_repository: Mock,
    _read_status: Mock,
) -> None:
    running = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = running

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), running.id)

    assert result.stage is ScanStage.READING_CODE
    assert (result.files_done, result.files_total) == (120, 1240)
    assert result.typical_seconds == 130


@pytest.mark.parametrize(
    "status",
    [AnalysisStatus.QUEUED, AnalysisStatus.DONE, AnalysisStatus.ERROR, AnalysisStatus.CANCELLED],
)
@patch("codesage_api.services.analysis.progress.read_status")
@patch("codesage_api.services.analysis.attempts")
def test_stage_details_are_absent_unless_running(
    attempt_repository: Mock,
    read_status: Mock,
    status: AnalysisStatus,
) -> None:
    attempt = _attempt(status)
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id)

    assert result.stage is None
    assert result.files_done is None and result.files_total is None
    read_status.assert_not_called()


@patch(
    "codesage_api.services.analysis.progress.read_status",
    return_value=progress.ProgressReading(percent=40, stage="a_stage_from_the_future"),
)
@patch("codesage_api.services.analysis.attempts")
def test_an_unknown_stage_reads_as_not_reported_never_a_500(
    attempt_repository: Mock,
    _read_status: Mock,
) -> None:
    running = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = running

    result = analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), running.id)

    assert result.stage is None
    assert result.progress == 40


# ── scan progress v2: the sub-steps of reading_code ─────────────────────────

# Every count set at once, as a stale or buggy worker might leave them: the
# status must still show only the count that belongs to the step.
_EVERY_COUNT = {"commits_done": 340, "commits_total": 1212, "files_done": 214, "files_total": 329}


def _running_status(reading: progress.ProgressReading):
    running = _attempt(AnalysisStatus.RUNNING)
    attempts = Mock()
    attempts.get_for_repository.return_value = running
    with (
        patch("codesage_api.services.analysis.attempts", attempts),
        patch("codesage_api.services.analysis.progress.read_status", return_value=reading),
    ):
        return analysis.get_status(Mock(), uuid.uuid4(), uuid.uuid4(), running.id)


@pytest.mark.parametrize(
    ("step", "commits", "files"),
    [
        ("measuring_code", (None, None), (None, None)),
        ("reading_history", (340, 1212), (None, None)),
        ("reading_comments", (None, None), (214, 329)),
    ],
)
def test_each_step_shows_only_its_own_count(
    step: str, commits: tuple[int | None, int | None], files: tuple[int | None, int | None]
) -> None:
    result = _running_status(
        progress.ProgressReading(percent=40, stage="reading_code", step=step, **_EVERY_COUNT)
    )

    assert result.step is ScanStep(step)
    assert (result.commits_done, result.commits_total) == commits
    assert (result.files_done, result.files_total) == files


def test_a_step_outside_reading_code_is_not_reported() -> None:
    result = _running_status(
        progress.ProgressReading(
            percent=62,
            stage="finding_debt",
            step="reading_history",
            commits_done=3,
            commits_total=9,
        )
    )

    assert result.stage is ScanStage.FINDING_DEBT
    assert result.step is None
    assert (result.commits_done, result.commits_total) == (None, None)


def test_an_unknown_step_reads_as_not_reported_never_a_500() -> None:
    result = _running_status(
        progress.ProgressReading(
            percent=40, stage="reading_code", step="a_step_from_the_future", **_EVERY_COUNT
        )
    )

    assert result.stage is ScanStage.READING_CODE
    assert result.step is None
    assert (result.commits_done, result.commits_total) == (None, None)


def test_an_uncounted_history_reports_the_step_without_counts() -> None:
    result = _running_status(
        progress.ProgressReading(percent=37, stage="reading_code", step="reading_history")
    )

    assert result.step is ScanStep.READING_HISTORY
    assert (result.commits_done, result.commits_total) == (None, None)


def test_the_step_fields_are_on_the_wire_in_snake_case() -> None:
    result = _running_status(
        progress.ProgressReading(
            percent=40, stage="reading_code", step="reading_history", **_EVERY_COUNT
        )
    )

    payload = result.model_dump(mode="json")
    assert payload["step"] == "reading_history"
    assert (payload["commits_done"], payload["commits_total"]) == (340, 1212)
    assert (payload["files_done"], payload["files_total"]) == (None, None)


# ── the per-workspace queue cap ─────────────────────────────────────────────


def _ready_to_queue(attempt_repository: Mock, github_fetch: Mock, waiting: int) -> None:
    attempt_repository.lock_repository_for_scan.return_value = SimpleNamespace()
    attempt_repository.get_branch.return_value = _branch()
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = None
    attempt_repository.create_queued.return_value = _attempt(AnalysisStatus.QUEUED)
    attempt_repository.count_queued_in_workspace.return_value = waiting
    github_fetch.return_value = GitHubBranch("main", "new-sha")


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_a_full_workspace_queue_refuses_with_a_clear_sentence(
    attempt_repository: Mock,
    github_fetch: Mock,
    enqueue: Mock,
) -> None:
    _ready_to_queue(attempt_repository, github_fetch, waiting=5)
    session = Mock()

    with pytest.raises(ScanQueueFull) as refused:
        analysis.start(session, uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    assert refused.value.code == "SCAN_QUEUE_FULL"
    assert refused.value.status_code == 429
    assert refused.value.message == (
        "5 scans are already waiting in this workspace. Try again when one finishes."
    )
    attempt_repository.create_queued.assert_not_called()
    session.commit.assert_not_called()
    enqueue.assert_not_called()


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_the_last_place_in_the_queue_is_taken_under_the_workspace_lock(
    attempt_repository: Mock,
    github_fetch: Mock,
    _enqueue: Mock,
) -> None:
    _ready_to_queue(attempt_repository, github_fetch, waiting=4)
    session = Mock()
    workspace_id = uuid.uuid4()
    order: list[str] = []
    attempt_repository.lock_workspace_queue.side_effect = lambda *_: order.append("lock")
    attempt_repository.count_queued_in_workspace.side_effect = lambda *_: order.append("count") or 4
    attempt_repository.create_queued.side_effect = lambda *_, **__: (
        order.append("create") or _attempt(AnalysisStatus.QUEUED)
    )
    session.commit.side_effect = lambda: order.append("commit")

    result = analysis.start(session, workspace_id, uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    assert result.phase is ScanPhase.QUEUED
    assert order == ["lock", "count", "create", "commit"]
    attempt_repository.lock_workspace_queue.assert_called_once_with(session, workspace_id)


@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_joining_a_running_scan_never_counts_against_the_queue(
    attempt_repository: Mock,
    github_fetch: Mock,
) -> None:
    _ready_to_queue(attempt_repository, github_fetch, waiting=99)
    attempt_repository.find_active_for_branch.return_value = _attempt(AnalysisStatus.RUNNING)

    with pytest.raises(analysis.ScanAlreadyRunning):
        analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    attempt_repository.count_queued_in_workspace.assert_not_called()


@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_nothing_new_to_scan_never_counts_against_the_queue(
    attempt_repository: Mock,
    github_fetch: Mock,
) -> None:
    _ready_to_queue(attempt_repository, github_fetch, waiting=99)
    attempt_repository.find_latest_completed.return_value = _attempt(
        AnalysisStatus.DONE, commit_sha="new-sha"
    )

    result = analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())

    assert result.phase is ScanPhase.DONE
    attempt_repository.count_queued_in_workspace.assert_not_called()


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
@pytest.mark.parametrize(
    "previous_scope",
    [
        None,
        {
            "test_path_patterns": ["old/**"],
            "production_path_overrides": [],
            "scan_excluded_directories": False,
        },
    ],
)
def test_same_commit_is_rescanned_after_exclusion_changes(
    attempt_repository, github_fetch, enqueue, previous_scope
):
    branch = _branch()
    completed = _attempt(AnalysisStatus.DONE, "same-sha")
    completed.source_scope_config = previous_scope
    queued = _attempt(AnalysisStatus.QUEUED, "same-sha")
    attempt_repository.lock_repository_for_scan.return_value = SimpleNamespace()
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = completed
    attempt_repository.count_queued_in_workspace.return_value = 0
    attempt_repository.create_queued.return_value = queued
    github_fetch.return_value = GitHubBranch("main", "same-sha")
    result = analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())
    assert result.phase is ScanPhase.QUEUED
    assert attempt_repository.create_queued.call_args.kwargs[
        "source_scope_config"
    ] == analysis.scan_scope_config(branch.repository)


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
@pytest.mark.parametrize(("old", "new"), [([], ["large-file"]), (["large-file"], [])])
def test_rule_selection_change_allows_same_commit_rescan(
    attempt_repository, github_fetch, enqueue, rule_selection, old, new
):
    session = Mock()
    branch = _branch()
    completed = _attempt(AnalysisStatus.DONE, commit_sha="new-sha")
    if old:
        completed.source_scope_config["disabled_rule_ids"] = old
    previous = completed.source_scope_config.copy()
    rule_selection.return_value = new
    _ready_to_queue(attempt_repository, github_fetch, waiting=0)
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_latest_completed.return_value = completed
    result = analysis.start(session, uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())
    assert result.phase is ScanPhase.QUEUED
    stamped = attempt_repository.create_queued.call_args.kwargs["source_scope_config"]
    assert stamped.get("disabled_rule_ids", []) == new
    assert completed.source_scope_config == previous
    enqueue.assert_called_once()


@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_unchanged_rule_selection_reuses_same_commit(
    attempt_repository, github_fetch, rule_selection
):
    _ready_to_queue(attempt_repository, github_fetch, waiting=99)
    completed = _attempt(AnalysisStatus.DONE, commit_sha="new-sha")
    completed.source_scope_config["disabled_rule_ids"] = ["large-file"]
    attempt_repository.find_latest_completed.return_value = completed
    rule_selection.return_value = ["large-file"]
    assert (
        analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4()).phase
        is ScanPhase.DONE
    )
    attempt_repository.create_queued.assert_not_called()


@patch("codesage_api.tasks.scan_pipeline.run_scan.delay")
@patch("codesage_api.services.analysis.fetch_branch")
@patch("codesage_api.services.analysis.attempts")
def test_comment_rule_changes_freeze_settings_and_allow_same_commit_rescan(attempt_repository, github_fetch, enqueue):
    config = {"id": str(uuid.uuid4()), "name": "TODO marker", "match_type": "keyword", "pattern": "TODO", "case_sensitive": False, "category": "code-design", "severity": "medium", "enabled": True}
    _ready_to_queue(attempt_repository, github_fetch, waiting=0)
    completed = _attempt(AnalysisStatus.DONE, commit_sha="new-sha")
    attempt_repository.find_latest_completed.return_value = completed
    with patch("codesage_api.services.analysis.workspace_rules.comment_rules", return_value=[config]):
        result = analysis.start(Mock(), uuid.uuid4(), uuid.uuid4(), "main", actor_user_id=uuid.uuid4())
    assert result.phase is ScanPhase.QUEUED
    stamped = attempt_repository.create_queued.call_args.kwargs["source_scope_config"]
    assert stamped["comment_rules"] == [config]
    assert "comment_rules" not in completed.source_scope_config
    enqueue.assert_called_once()
