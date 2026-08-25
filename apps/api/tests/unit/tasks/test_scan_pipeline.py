from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.repositories.attempts import WorkerScanInput
from codesage_api.extractors.pipeline import ExtractionResult
from codesage_api.tasks.cancel import ScanCancelled
from codesage_api.tasks.scan_pipeline import PipelineResults, run_scan


@patch("codesage_api.tasks.scan_pipeline.cancel.check")
@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._finalize")
@patch("codesage_api.tasks.scan_pipeline.detect")
@patch("codesage_api.tasks.scan_pipeline.extract")
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_runs_clone_extract_detect_and_finalize_in_order(
    session_scope: Mock,
    begin: Mock,
    clone: Mock,
    extract: Mock,
    detect: Mock,
    finalize: Mock,
    cleanup: Mock,
    _check: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput(
        "https://github.com/example/repo.git", "a" * 40
    )
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )
    extracted = ExtractionResult([], [], [])
    extract.return_value = extracted
    detect.return_value = []

    run_scan.run(str(attempt_id), str(workspace_id))

    clone.assert_called_once()
    extract.assert_called_once()
    detect.assert_called_once()
    finalize.assert_called_once_with(
        attempt_id,
        workspace_id,
        PipelineResults(extracted, []),
    )
    cleanup.assert_called_once_with(str(attempt_id), str(tmp_path))


@patch("codesage_api.tasks.scan_pipeline.cancel.check")
@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._set_terminal")
@patch("codesage_api.tasks.scan_pipeline.extract", side_effect=RuntimeError)
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_records_a_durable_error_when_a_stage_fails(
    session_scope: Mock,
    begin: Mock,
    clone: Mock,
    _extract: Mock,
    terminal: Mock,
    cleanup: Mock,
    _check: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput(
        "https://github.com/example/repo.git", "a" * 40
    )
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )

    run_scan.run(str(attempt_id), str(workspace_id))

    terminal.assert_called_once_with(
        attempt_id,
        workspace_id,
        AnalysisStatus.ERROR,
        "The repository could not be analysed.",
    )
    cleanup.assert_called_once_with(str(attempt_id), str(tmp_path))


@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._set_terminal")
@patch(
    "codesage_api.tasks.scan_pipeline.cancel.check",
    side_effect=[None, ScanCancelled],
)
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_records_cancelled_and_cleans_clone(
    session_scope: Mock,
    begin: Mock,
    clone: Mock,
    _check: Mock,
    terminal: Mock,
    cleanup: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput(
        "https://github.com/example/repo.git", "a" * 40
    )
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )

    run_scan.run(str(attempt_id), str(workspace_id))

    terminal.assert_called_once_with(
        attempt_id,
        workspace_id,
        AnalysisStatus.CANCELLED,
        None,
    )
    cleanup.assert_called_once_with(str(attempt_id), str(tmp_path))
