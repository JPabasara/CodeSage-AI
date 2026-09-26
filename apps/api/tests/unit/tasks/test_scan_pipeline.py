from __future__ import annotations

import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from celery.exceptions import Retry, SoftTimeLimitExceeded

from codesage_api.db.enums import (
    AnalysisStatus,
    AnalysisTriggerType,
    MLModelType,
    ModelDeploymentStatus,
    Severity,
)
from codesage_api.db.models import (
    AnalysisAttempt,
    BugRiskPrediction,
    ClassRiskPrediction,
    Finding,
    MLModelVersion,
    SATDPrediction,
    SourceFile,
)
from codesage_api.db.repositories.attempts import WorkerScanInput, WorkspaceScanSlotBusy
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.detection.satd.client import SATDResult
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.extractors.pipeline import ExtractionResult
from codesage_api.guardrails import (
    NO_JAVA_MESSAGE,
    JavaInventory,
    ScanLimitReached,
    git_timed_out_message,
    timed_out_message,
)
from codesage_api.scoring.enums import Category, ScanErrorCode
from codesage_api.tasks import scan_pipeline
from codesage_api.tasks.cancel import ScanCancelled
from codesage_api.tasks.repository_clone import CloneError, CloneTimedOut
from codesage_api.tasks.scan_pipeline import PipelineResults, _finalize, run_scan


@pytest.fixture(autouse=True)
def _guardrails_pass():
    """The stage tests below are about ordering, not limits: let every branch
    through the Java check and skip the stale-clone sweep. The 13H.1 tests at
    the end of this file override these where they matter."""
    with (
        patch(
            "codesage_api.tasks.scan_pipeline.check_java_sources",
            return_value=JavaInventory(files=1, lines=1),
        ),
        patch("codesage_api.tasks.scan_pipeline.sweep_stale_clones", return_value=0),
    ):
        yield


@patch("codesage_api.tasks.scan_pipeline.set_workspace_context")
@patch("codesage_api.tasks.scan_pipeline.attempts.get_worker_attempt")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_finalize_records_trained_risk_provenance(
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
        version_identifier="risk-2.0.0",
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
            ExtractionResult(
                static_metrics=[],
                class_metrics=[],
                process_metrics=[],
                comments=[],
            ),
            [],
            RiskClientResult(
                class_scores={},
                file_scores={"src/Main.java": 0.7},
                model_version="risk-2.0.0",
            ),
        ),
    )

    assert session.execute.called
    assert session.scalar.called
    registration = session.execute.call_args_list[0].args[0].compile().params
    assert registration["evaluation_dataset_reference"] == "D'Ambros/AEEEM"
    assert registration["evaluation_metrics"] == {
        "registration": "runtime model response",
    }
    assert any(
        getattr(added, "model_version_id", None) == model_version.id
        for added in (call.args[0] for call in session.add.call_args_list)
    )


@patch("codesage_api.tasks.scan_pipeline.set_workspace_context")
@patch("codesage_api.tasks.scan_pipeline.attempts.get_worker_attempt")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_finalize_persists_file_and_class_risk_and_finding_context(
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
        version_identifier="risk-2.0.0",
        training_date=SimpleNamespace(),
        deployment_status=ModelDeploymentStatus.DEPLOYED,
        evaluation_dataset_reference="D'Ambros/AEEEM",
        evaluation_metrics={},
    )
    session = session_scope.return_value.__enter__.return_value
    session.scalar.return_value = model_version
    session.get.return_value = None
    metrics = FileMetrics(
        path="src/Foo.java",
        loc=100,
        cyclomatic_complexity=5,
        max_nesting_depth=2,
        method_count=3,
        longest_method_lines=20,
        cbo=1.0,
        dit=1.0,
        lcom=0.0,
        rfc=4.0,
        noc=0.0,
    )
    finding = DetectedFinding(
        file_path="src/Foo.java",
        line=12,
        symbol="Foo.work",
        rule_id="long-method",
        category=Category.CODE_DESIGN,
        severity=Severity.MEDIUM,
        description="Long method",
        evidence="long-method=90",
        measured_value=90.0,
        threshold=80.0,
        fingerprint="fingerprint",
        class_name="Foo",
        method_name="work",
    )

    _finalize(
        attempt.id,
        uuid.uuid4(),
        PipelineResults(
            ExtractionResult(
                static_metrics=[metrics],
                class_metrics=[],
                process_metrics=[],
                comments=[],
            ),
            [finding],
            RiskClientResult(
                class_scores={
                    ("src/Foo.java", "Foo"): 0.8,
                    ("src/Foo.java", "Helper"): 0.25,
                },
                file_scores={"src/Foo.java": 0.85},
                model_version="risk-2.0.0",
            ),
        ),
    )

    added = [call.args[0] for call in session.add.call_args_list]
    file_prediction = next(
        item for item in added if isinstance(item, BugRiskPrediction)
    )
    class_predictions = [
        item for item in added if isinstance(item, ClassRiskPrediction)
    ]
    stored_finding = next(item for item in added if isinstance(item, Finding))

    assert file_prediction.risk_score == 0.85
    assert {
        item.class_name: item.risk_score for item in class_predictions
    } == {"Foo": 0.8, "Helper": 0.25}
    assert stored_finding.class_name == "Foo"
    assert stored_finding.method_name == "work"


@patch("codesage_api.tasks.scan_pipeline.set_workspace_context")
@patch("codesage_api.tasks.scan_pipeline.attempts.get_worker_attempt")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_finalize_persists_satd_when_ck_omits_source_file(
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
        model_type=MLModelType.SATD,
        version_identifier="satd-1.0.0",
        training_date=SimpleNamespace(),
        deployment_status=ModelDeploymentStatus.DEPLOYED,
        evaluation_dataset_reference="SATDAUG",
        evaluation_metrics={},
    )
    session = session_scope.return_value.__enter__.return_value
    session.scalar.return_value = model_version
    session.get.return_value = None
    comment = ExtractedComment(
        "src/generated/Skipped.java",
        4,
        "// TODO: replace generated workaround",
    )

    _finalize(
        attempt.id,
        uuid.uuid4(),
        PipelineResults(
            ExtractionResult(
                static_metrics=[],
                class_metrics=[],
                process_metrics=[],
                comments=[comment],
            ),
            [],
            satd_predictions=[
                SATDResult(
                    comment=comment,
                    is_debt=True,
                    category=Category.CODE_DESIGN,
                    confidence=0.91,
                    model_version="satd-1.0.0",
                )
            ],
        ),
    )

    added = [call.args[0] for call in session.add.call_args_list]
    source_file = next(item for item in added if isinstance(item, SourceFile))
    prediction = next(item for item in added if isinstance(item, SATDPrediction))

    assert source_file.relative_path == "src/generated/Skipped.java"
    assert prediction.source_location.source_file is source_file


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
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main")
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
    extracted = ExtractionResult(
        static_metrics=[],
        class_metrics=[],
        process_metrics=[],
        comments=[comment],
    )
    extract.return_value = extracted
    detect.return_value = []
    risk_res = RiskClientResult(
        class_scores={("Main.java", "Main"): 0.85},
        file_scores={"Main.java": 0.85},
        model_version="risk-2.0.0",
    )
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
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main")
    list_definitions.return_value = []
    clone.return_value = SimpleNamespace(
        path=tmp_path,
        commit_sha="a" * 40,
        committer_date=SimpleNamespace(),
    )
    extracted = ExtractionResult(
        static_metrics=[],
        class_metrics=[],
        process_metrics=[],
        comments=[],
    )
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
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main")
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
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main")
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


# ── 13H.1: guardrail endings, time limits, cleanup and the workspace slot ───

_PIPELINE = "codesage_api.tasks.scan_pipeline"


class _Run:
    """One `run_scan` with every collaborator replaced, so each test changes
    only the stage it is about."""

    def __init__(self, tmp_path: Path) -> None:
        self.attempt_id = uuid.uuid4()
        self.workspace_id = uuid.uuid4()
        self.clone_dir = tmp_path / str(self.attempt_id)
        self._mocks: dict[str, Mock] = {
            "session_scope": MagicMock(),
            "attempts.begin_for_worker": Mock(
                return_value=WorkerScanInput(
                    "https://github.com/example/repo.git", "a" * 40, "feature/x"
                )
            ),
            "rules.list_definitions": Mock(return_value=[]),
            "clone_path": Mock(return_value=self.clone_dir),
            "clone_at_commit": Mock(
                return_value=SimpleNamespace(
                    path=self.clone_dir,
                    commit_sha="a" * 40,
                    committer_date=SimpleNamespace(),
                )
            ),
            "extract": Mock(
                return_value=ExtractionResult(
                    static_metrics=[], class_metrics=[], process_metrics=[], comments=[]
                )
            ),
            "detect": Mock(return_value=[]),
            "risk_client.predict": Mock(return_value=None),
            "classify": Mock(return_value=[]),
            "_finalize": Mock(return_value=uuid.uuid4()),
            "_set_terminal": Mock(),
            "celery_app.send_task": Mock(),
            "cancel.check": Mock(),
            "cancel.cleanup": Mock(),
            "progress.publish_stage": Mock(),
            "progress.publish_files_done": Mock(),
            "progress.is_cancel_requested": Mock(return_value=False),
            "progress.clear": Mock(),
        }

    def __getitem__(self, name: str) -> Mock:
        return self._mocks[name]

    def __call__(self) -> None:
        with ExitStack() as stack:
            for name, mock in self._mocks.items():
                stack.enter_context(patch(f"{_PIPELINE}.{name}", mock))
            run_scan.run(str(self.attempt_id), str(self.workspace_id))

    def ended_with(self, status: AnalysisStatus, *details: object) -> None:
        self["_set_terminal"].assert_called_once_with(
            self.attempt_id, self.workspace_id, status, *details
        )


@pytest.fixture
def scan(tmp_path: Path) -> _Run:
    return _Run(tmp_path)


def test_the_scanned_branch_alone_is_cloned(scan: _Run) -> None:
    scan()

    assert scan["clone_at_commit"].call_args.kwargs == {"branch": "feature/x"}
    scan["_finalize"].assert_called_once()


def test_a_branch_with_no_java_ends_cleanly_before_extraction(scan: _Run) -> None:
    with patch(
        f"{_PIPELINE}.check_java_sources",
        side_effect=ScanLimitReached(ScanErrorCode.NO_JAVA_FILES, NO_JAVA_MESSAGE),
    ):
        scan()

    scan.ended_with(AnalysisStatus.ERROR, NO_JAVA_MESSAGE, ScanErrorCode.NO_JAVA_FILES)
    scan["extract"].assert_not_called()
    scan["_finalize"].assert_not_called()
    scan["cancel.cleanup"].assert_called_once_with(str(scan.attempt_id), str(scan.clone_dir))


def test_a_branch_over_the_limits_ends_as_too_large(scan: _Run) -> None:
    message = (
        "This branch has 7,210 Java files, more than the 5,000 CodeSage can analyse today."
    )
    with patch(
        f"{_PIPELINE}.check_java_sources",
        side_effect=ScanLimitReached(ScanErrorCode.REPOSITORY_TOO_LARGE, message),
    ):
        scan()

    scan.ended_with(AnalysisStatus.ERROR, message, ScanErrorCode.REPOSITORY_TOO_LARGE)
    scan["extract"].assert_not_called()


def test_the_soft_time_limit_ends_the_scan_and_still_cleans_up(scan: _Run) -> None:
    scan["extract"].side_effect = SoftTimeLimitExceeded()

    scan()

    scan.ended_with(AnalysisStatus.ERROR, timed_out_message(), ScanErrorCode.SCAN_TIMED_OUT)
    scan["_finalize"].assert_not_called()
    scan["cancel.cleanup"].assert_called_once_with(str(scan.attempt_id), str(scan.clone_dir))


def test_a_time_limit_inside_an_ml_call_is_not_mistaken_for_degraded_mode(
    scan: _Run,
) -> None:
    """The ML clients wrap every exception as MLServiceUnavailable. Unwrapped,
    the soft limit would become "carry on without SATD" and the scan would run
    on into the hard kill, which skips `finally`."""
    wrapped = MLServiceUnavailable("Failed to communicate with ML service")
    wrapped.__cause__ = SoftTimeLimitExceeded()
    scan["classify"].side_effect = wrapped

    scan()

    scan.ended_with(AnalysisStatus.ERROR, timed_out_message(), ScanErrorCode.SCAN_TIMED_OUT)
    scan["_finalize"].assert_not_called()


def test_a_git_timeout_ends_the_scan_as_timed_out(scan: _Run) -> None:
    scan["clone_at_commit"].side_effect = CloneTimedOut("Git did not finish in time.")

    scan()

    scan.ended_with(
        AnalysisStatus.ERROR, git_timed_out_message(), ScanErrorCode.SCAN_TIMED_OUT
    )


def test_the_clone_folder_is_deleted_even_when_the_clone_itself_fails(scan: _Run) -> None:
    # The clone never returned a path, so the pipeline has to know it already.
    scan["clone_at_commit"].side_effect = CloneError("network")

    scan()

    scan.ended_with(AnalysisStatus.ERROR, "The repository could not be analysed.")
    scan["cancel.cleanup"].assert_called_once_with(str(scan.attempt_id), str(scan.clone_dir))


def test_satd_comments_are_capped_before_the_ml_call(scan: _Run, monkeypatch) -> None:
    from codesage_api import guardrails
    from codesage_api.config import Settings

    monkeypatch.setattr(guardrails, "get_settings", lambda: Settings(max_satd_comments=2))
    comments = [ExtractedComment("A.java", line, f"// TODO {line}") for line in range(5)]
    scan["extract"].return_value = ExtractionResult(
        static_metrics=[], class_metrics=[], process_metrics=[], comments=comments
    )

    scan()

    scan["classify"].assert_called_once_with(comments[:2])


def test_a_busy_workspace_keeps_the_scan_queued_and_asks_again(scan: _Run) -> None:
    scan["attempts.begin_for_worker"].side_effect = WorkspaceScanSlotBusy

    with patch.object(run_scan, "retry", side_effect=Retry()) as retry, pytest.raises(Retry):
        scan()

    retry.assert_called_once_with(countdown=15, max_retries=None)
    scan["clone_at_commit"].assert_not_called()
    scan["_set_terminal"].assert_not_called()
    # The cancel flag belongs to the still-queued attempt; keep it.
    scan["cancel.cleanup"].assert_not_called()
    scan["progress.clear"].assert_not_called()


def test_stop_pressed_while_waiting_for_a_slot_cancels_the_scan(scan: _Run) -> None:
    scan["attempts.begin_for_worker"].side_effect = WorkspaceScanSlotBusy
    scan["progress.is_cancel_requested"].return_value = True

    with patch.object(run_scan, "retry") as retry:
        scan()

    retry.assert_not_called()
    scan.ended_with(AnalysisStatus.CANCELLED, None)
    scan["progress.clear"].assert_called_once_with(str(scan.attempt_id))


def test_an_attempt_that_already_ended_is_not_restarted(scan: _Run) -> None:
    scan["attempts.begin_for_worker"].return_value = None

    scan()

    scan["clone_at_commit"].assert_not_called()
    scan["_set_terminal"].assert_not_called()


def test_the_scan_task_carries_both_time_limits() -> None:
    assert run_scan.soft_time_limit == 14 * 60
    assert run_scan.time_limit == 15 * 60


# ── 13H.4: named stages, file counts and the typical duration ──────────────


def test_every_stage_is_published_in_order_with_its_band_start(scan: _Run) -> None:
    scan["attempts.begin_for_worker"].return_value = WorkerScanInput(
        "https://github.com/example/repo.git", "a" * 40, "main", typical_seconds=130
    )
    with patch(
        f"{_PIPELINE}.check_java_sources",
        return_value=SimpleNamespace(files=1240, lines=90_000),
    ):
        scan()

    calls = scan["progress.publish_stage"].call_args_list
    assert [(c.args[1], c.args[2]) for c in calls] == [
        ("cloning", 5),
        ("reading_code", 25),
        ("finding_debt", 60),
        ("predicting_risk", 70),
        ("scoring", 85),
        ("finishing", 97),
    ]
    # The typical duration rides on the first stage; the file total on reading.
    assert calls[0].kwargs == {"typical_seconds": 130}
    assert calls[1].kwargs == {"files_total": 1240}
    # Extraction was handed a file reporter.
    assert callable(scan["extract"].call_args.kwargs["on_file"])


def test_the_file_reporter_publishes_about_fifty_counts_and_always_the_last() -> None:
    with patch(f"{_PIPELINE}.progress.publish_files_done") as publish:
        report = scan_pipeline._file_reporter("scan-id")
        for done in range(1, 1001):
            report(done, 1000)

    published = [c.args[1] for c in publish.call_args_list]
    assert len(published) == scan_pipeline.FILE_REPORTS_PER_SCAN
    assert published[-1] == 1000
    assert published == sorted(published)


def test_a_tiny_repository_reports_every_file() -> None:
    with patch(f"{_PIPELINE}.progress.publish_files_done") as publish:
        report = scan_pipeline._file_reporter("scan-id")
        for done in range(1, 4):
            report(done, 3)

    assert [c.args[1] for c in publish.call_args_list] == [1, 2, 3]
