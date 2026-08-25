from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from codesage_api.db.enums import AnalysisStatus
from codesage_api.errors import NotFound
from codesage_api.integrations.github import GitHubBranch
from codesage_api.scoring.enums import ScanPhase
from codesage_api.services import analysis


def _branch() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        name="main",
        head_commit_sha="old-sha",
        repository=SimpleNamespace(owner="acme", name="widget"),
    )


def _attempt(status: AnalysisStatus, commit_sha: str = "new-sha") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        commit_sha=commit_sha,
        start_time=None,
        completion_time=None,
        failure_information=None,
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
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = None
    attempt_repository.create_queued.return_value = queued
    github_fetch.return_value = GitHubBranch("main", "new-sha")

    workspace_id = uuid.uuid4()
    result = analysis.start(session, workspace_id, uuid.uuid4(), "main")

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
    attempt_repository.get_branch.return_value = branch
    attempt_repository.find_active_for_branch.return_value = None
    attempt_repository.find_latest_completed.return_value = completed
    github_fetch.return_value = GitHubBranch("main", "same-sha")

    result = analysis.start(
        session,
        uuid.uuid4(),
        uuid.uuid4(),
        "main",
    )

    assert result.phase is ScanPhase.DONE
    assert result.progress == 100
    attempt_repository.create_queued.assert_not_called()
    session.commit.assert_not_called()


@patch("codesage_api.services.analysis.progress.read_progress", return_value=47)
@patch("codesage_api.services.analysis.attempts")
def test_get_status_reads_durable_phase_and_ephemeral_progress(
    attempt_repository: Mock,
    read_progress: Mock,
) -> None:
    running = _attempt(AnalysisStatus.RUNNING)
    attempt_repository.get_for_repository.return_value = running

    result = analysis.get_status(
        Mock(), uuid.uuid4(), uuid.uuid4(), running.id
    )

    assert result.phase is ScanPhase.RUNNING
    assert result.progress == 47
    read_progress.assert_called_once_with(str(running.id))


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
@patch("codesage_api.services.analysis.progress.read_progress", return_value=47)
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

    result = analysis.get_status(
        Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id
    )

    assert result.phase is expected_phase
    assert result.progress == expected_progress


@pytest.mark.parametrize("status", [AnalysisStatus.QUEUED, AnalysisStatus.RUNNING])
@patch("codesage_api.services.analysis.progress.request_cancel")
@patch("codesage_api.services.analysis.attempts")
def test_cancel_requests_cooperative_stop_for_active_attempt(
    attempt_repository: Mock,
    request_cancel: Mock,
    status: AnalysisStatus,
) -> None:
    attempt = _attempt(status)
    attempt_repository.get_for_repository.return_value = attempt

    result = analysis.cancel(
        Mock(), uuid.uuid4(), uuid.uuid4(), attempt.id
    )

    request_cancel.assert_called_once_with(str(attempt.id))
    assert result.phase is ScanPhase(status.value)


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
