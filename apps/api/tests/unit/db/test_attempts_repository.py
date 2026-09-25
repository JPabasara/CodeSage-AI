from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt, Branch, Repository
from codesage_api.db.repositories.attempts import (
    ENGINE_TOOL_VERSIONS,
    ENGINE_VERSION_IDENTIFIER,
    WorkerScanInput,
    WorkspaceScanSlotBusy,
    begin_for_worker,
    expire_stale_running,
    get_or_create_engine_version,
)


def test_new_engine_version_records_reproducible_extraction_toolchain() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    version = get_or_create_engine_version(session)

    assert version.version_identifier == ENGINE_VERSION_IDENTIFIER == "codesage-v2"
    assert version.tool_versions == {"ck": "0.7.0", "pydriller": "2.10"}
    assert version.extraction_logic_version == "v2"
    session.add.assert_called_once_with(version)
    session.flush.assert_called_once_with()


def test_existing_engine_version_is_reused() -> None:
    session = MagicMock()
    existing = object()
    session.scalar.return_value = existing

    assert get_or_create_engine_version(session) is existing
    session.add.assert_not_called()
    session.flush.assert_not_called()


def test_engine_tool_versions_are_copied_into_each_record() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    version = get_or_create_engine_version(session)
    version.tool_versions["ck"] = "changed"

    assert ENGINE_TOOL_VERSIONS["ck"] == "0.7.0"


# ── 13H.1: one running scan per workspace, and abandoned rows ───────────────


def _worker_attempt(status: AnalysisStatus) -> AnalysisAttempt:
    repository = Repository(url="https://github.com/acme/widget")
    branch = Branch(name="feature/x", repository=repository)
    return AnalysisAttempt(
        id=uuid.uuid4(),
        branch=branch,
        commit_sha="a" * 40,
        status=status,
        failure_information="old failure",
        failure_code="SCAN_TIMED_OUT",
    )


def _claim(attempt: AnalysisAttempt | None, running_elsewhere: int) -> tuple[object, MagicMock]:
    session = MagicMock()
    session.scalar.side_effect = [attempt, running_elsewhere]
    return begin_for_worker(session, uuid.uuid4(), uuid.uuid4()), session


def test_a_free_slot_starts_the_attempt_and_hands_over_its_branch() -> None:
    attempt = _worker_attempt(AnalysisStatus.QUEUED)

    scan_input, _session = _claim(attempt, running_elsewhere=0)

    assert scan_input == WorkerScanInput(
        "https://github.com/acme/widget", "a" * 40, "feature/x"
    )
    assert attempt.status is AnalysisStatus.RUNNING
    assert attempt.start_time is not None
    # A retried attempt starts clean.
    assert attempt.failure_information is None
    assert attempt.failure_code is None


def test_the_slot_is_claimed_under_a_workspace_lock_taken_first() -> None:
    _scan_input, session = _claim(_worker_attempt(AnalysisStatus.QUEUED), 0)

    first = session.execute.call_args_list[0].args[0]
    assert "pg_advisory_xact_lock" in str(first)


def test_a_full_workspace_raises_busy_and_leaves_the_attempt_queued() -> None:
    attempt = _worker_attempt(AnalysisStatus.QUEUED)

    with pytest.raises(WorkspaceScanSlotBusy):
        _claim(attempt, running_elsewhere=1)

    assert attempt.status is AnalysisStatus.QUEUED
    assert attempt.start_time is None


@pytest.mark.parametrize(
    "status", [AnalysisStatus.DONE, AnalysisStatus.ERROR, AnalysisStatus.CANCELLED]
)
def test_an_attempt_that_already_ended_is_never_restarted(status: AnalysisStatus) -> None:
    """A redelivered message, or one whose row was expired, must not flip a
    finished attempt back to running."""
    attempt = _worker_attempt(status)

    scan_input, _session = _claim(attempt, running_elsewhere=0)

    assert scan_input is None
    assert attempt.status is status


def test_a_missing_attempt_is_none() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    assert begin_for_worker(session, uuid.uuid4(), uuid.uuid4()) is None


def test_abandoned_running_rows_end_as_timed_out() -> None:
    session = MagicMock()
    session.execute.return_value.rowcount = 2

    assert expire_stale_running(session, uuid.uuid4()) == 2

    statement = session.execute.call_args.args[0]
    params = statement.compile().params
    assert params["status"] == AnalysisStatus.ERROR
    assert params["failure_code"] == "SCAN_TIMED_OUT"
    assert params["failure_information"].startswith("The scan took longer than 15 minutes")
    # Only rows older than the hard limit plus the grace period: a live scan
    # is always younger than that.
    cutoff = next(value for key, value in params.items() if key.startswith("start_time"))
    age = (datetime.now(UTC) - cutoff).total_seconds()
    assert 15 * 60 + 5 * 60 - 5 < age < 15 * 60 + 5 * 60 + 5
