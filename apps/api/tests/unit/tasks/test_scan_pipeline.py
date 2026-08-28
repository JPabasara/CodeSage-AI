from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from codesage_api.db.enums import (
    AnalysisStatus,
    AnalysisTriggerType,
    MLModelType,
    ModelDeploymentStatus,
    Severity,
)
from codesage_api.db.models import AnalysisAttempt, MLModelVersion
from codesage_api.db.repositories.attempts import WorkerScanInput
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.satd.client import SATDResult
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.extractors.pipeline import ExtractionResult
from codesage_api.scoring.enums import Category
from codesage_api.tasks.cancel import ScanCancelled
from codesage_api.tasks.scan_pipeline import PipelineResults, _finalize, run_scan


@patch("codesage_api.tasks.scan_pipeline.set_workspace_context")
@patch("codesage_api.tasks.scan_pipeline.attempts.get_worker_attempt")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_finalize_registers_bug_risk_model_with_the_real_database_shape(
    session_scope: Mock,
    get_attempt: Mock,
    _set_workspace: Mock,
) -> None:
    attempt = AnalysisAttempt(
        id=uuid.uuid4(),
        branch_id=uuid.uuid4(),
        analysis_engine_version_id=uuid.uuid4(),
        commit_sha="a" * 40,
        trigger_type=AnalysisTriggerType.MANUAL,
        status=AnalysisStatus.RUNNING,
        retry_count=0,
    )
    get_attempt.return_value = attempt
    model_version = MLModelVersion(
        id=uuid.uuid4(),
        model_type=MLModelType.BUG_RISK,
        version_identifier="risk-1.0.0",
        training_date=SimpleNamespace(),
        deployment_status=ModelDeploymentStatus.DEPLOYED,
        evaluation_dataset_reference="D'Ambros/AEEEM",
        evaluation_metrics={},
    )
    session = session_scope.return_value.__enter__.return_value
    session.scalar.return_value = model_version
    session.get.return_value = None

    _finalize(
        attempt.id,
        uuid.uuid4(),
        PipelineResults(
            ExtractionResult([], [], []),
            [],
            RiskClientResult(
                scores={"src/Main.java": 0.7},
                model_version="risk-1.0.0",
            ),
        ),
    )

    assert session.execute.called
    assert session.scalar.called
    assert any(
        getattr(added, "model_version_id", None) == model_version.id
        for added in (call.args[0] for call in session.add.call_args_list)
    )


@patch("codesage_api.tasks.scan_pipeline.risk_client.predict")
@patch("codesage_api.tasks.scan_pipeline.cancel.check")
@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._finalize")
@patch("codesage_api.tasks.scan_pipeline.classify")
@patch("codesage_api.tasks.scan_pipeline.detect")
@patch("codesage_api.tasks.scan_pipeline.extract")
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.rules.list_definitions")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_runs_clone_extract_detect_and_finalize_in_order(
    session_scope: Mock,
    begin: Mock,
    list_definitions: Mock,
    clone: Mock,
    extract: Mock,
    detect: Mock,
    classify: Mock,
    finalize: Mock,
    cleanup: Mock,
    _check: Mock,
    predict: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40)
    stored_rule = SimpleNamespace(
        rule_id="large-file",
        category_id="code-design",
        severity=Severity.LOW,
        threshold=800.0,
        message_template="Large {file}",
    )
    list_definitions.return_value = [stored_rule]
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )
    comment = ExtractedComment("A.java", 3, "// TODO: temporary workaround")
    extracted = ExtractionResult([], [], [comment])
    extract.return_value = extracted
    detect.return_value = []
    risk_res = RiskClientResult(scores={"Main.java": 0.85}, model_version="risk-1.0.0")
    predict.return_value = risk_res
    prediction = SATDResult(
        comment=comment,
        is_debt=True,
        category=Category.CODE_DESIGN,
        confidence=0.91,
        model_version="satd-1.0.0",
    )
    classify.return_value = [prediction]

    run_scan.run(str(attempt_id), str(workspace_id))

    clone.assert_called_once()
    extract.assert_called_once()
    detect.assert_called_once()
    predict.assert_called_once()
    classify.assert_called_once_with([comment])
    detector_rules = detect.call_args.args[1]
    assert len(detector_rules) == 1
    assert detector_rules[0].rule_id == "large-file"
    assert detector_rules[0].threshold == 800.0
    finalize.assert_called_once_with(
        attempt_id,
        workspace_id,
        PipelineResults(extracted, [], risk_res, [prediction]),
    )
    cleanup.assert_called_once_with(str(attempt_id), str(tmp_path))


@patch("codesage_api.tasks.scan_pipeline.risk_client.predict", side_effect=MLServiceUnavailable)
@patch("codesage_api.tasks.scan_pipeline.cancel.check")
@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._finalize")
@patch("codesage_api.tasks.scan_pipeline.detect")
@patch("codesage_api.tasks.scan_pipeline.extract")
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.rules.list_definitions")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_handles_ml_service_degraded_mode(
    session_scope: Mock,
    begin: Mock,
    list_definitions: Mock,
    clone: Mock,
    extract: Mock,
    detect: Mock,
    finalize: Mock,
    cleanup: Mock,
    _check: Mock,
    _predict: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40)
    list_definitions.return_value = []
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )
    extracted = ExtractionResult([], [], [])
    extract.return_value = extracted
    detect.return_value = []

    run_scan.run(str(attempt_id), str(workspace_id))

    finalize.assert_called_once_with(
        attempt_id,
        workspace_id,
        PipelineResults(extracted, [], None),
    )
    cleanup.assert_called_once_with(str(attempt_id), str(tmp_path))


@patch("codesage_api.tasks.scan_pipeline.cancel.check")
@patch("codesage_api.tasks.scan_pipeline.cancel.cleanup")
@patch("codesage_api.tasks.scan_pipeline._set_terminal")
@patch("codesage_api.tasks.scan_pipeline.extract", side_effect=RuntimeError)
@patch("codesage_api.tasks.scan_pipeline.clone_at_commit")
@patch("codesage_api.tasks.scan_pipeline.rules.list_definitions")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_records_a_durable_error_when_a_stage_fails(
    session_scope: Mock,
    begin: Mock,
    list_definitions: Mock,
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
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40)
    list_definitions.return_value = []
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
@patch("codesage_api.tasks.scan_pipeline.rules.list_definitions")
@patch("codesage_api.tasks.scan_pipeline.attempts.begin_for_worker")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_task_records_cancelled_and_cleans_clone(
    session_scope: Mock,
    begin: Mock,
    list_definitions: Mock,
    clone: Mock,
    _check: Mock,
    terminal: Mock,
    cleanup: Mock,
    tmp_path: Path,
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40)
    list_definitions.return_value = []
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
