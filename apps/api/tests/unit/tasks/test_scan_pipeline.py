from __future__ import annotations

import uuid
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
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
    Branch,
    BugRiskPrediction,
    ClassRiskPrediction,
    Finding,
    MLModelVersion,
    Repository,
    SATDPrediction,
    SourceFile,
)
from codesage_api.db.repositories.attempts import (
    LOST_MESSAGE,
    WorkerScanInput,
    WorkspaceScanSlotBusy,
)
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.detection.satd.client import SATDResult
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import CKTimedOut, FileMetrics
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
        branch=Branch(repository=Repository(test_path_patterns=[], production_path_overrides=[])),
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
@pytest.mark.parametrize(
    ("rule_id", "occurrences"),
    [("long-method", 1), ("sql-concat", 2), ("pmd:ExceptionAsFlowControl", 2), ("comment-pattern", 2)],
)
def test_finalize_persists_file_and_class_risk_and_finding_context(
    session_scope: Mock,
    get_attempt: Mock,
    _set_workspace: Mock,
    rule_id: str,
    occurrences: int,
) -> None:
    attempt = AnalysisAttempt(
        id=uuid.uuid4(),
        branch=Branch(repository=Repository(test_path_patterns=[], production_path_overrides=[])),
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
        rule_id=rule_id,
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
            [finding] * occurrences,
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
    file_prediction = next(item for item in added if isinstance(item, BugRiskPrediction))
    class_predictions = [item for item in added if isinstance(item, ClassRiskPrediction)]
    stored_finding = next(item for item in added if isinstance(item, Finding))
    stored_findings = [item for item in added if isinstance(item, Finding)]
    assert len(stored_findings) == occurrences
    assert len({item.fingerprint for item in stored_findings}) == occurrences
    assert stored_findings[0].fingerprint == finding.fingerprint
    assert all(item.rule_id == rule_id for item in stored_findings)

    assert file_prediction.risk_score == 0.85
    assert {item.class_name: item.risk_score for item in class_predictions} == {
        "Foo": 0.8,
        "Helper": 0.25,
    }
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
        branch=Branch(repository=Repository(test_path_patterns=[], production_path_overrides=[])),
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
@pytest.mark.parametrize("disabled", [[], ["large-file"]])
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
    disabled: list[str],
) -> None:
    attempt_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    session_scope.return_value.__enter__.return_value = Mock()
    begin.return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main", source_scope_config={"scan_excluded_directories": True, "disabled_rule_ids": disabled})
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
    assert callable(extract.call_args.kwargs["on_step"])
    assert callable(extract.call_args.kwargs["on_commit"])
    detect.assert_called_once()
    predict.assert_called_once()
    classify.assert_called_once_with([comment])
    detector_rules = detect.call_args.args[1]
    if disabled:
        assert detector_rules == []
    else:
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
        failure_code="SCAN_FAILED",
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
            "progress.publish_step": Mock(),
            "progress.publish_commits_done": Mock(),
            "progress.is_cancel_requested": Mock(return_value=False),
            "progress.clear": Mock(),
            "progress.mark_waiting": Mock(),
            "_sync_demand": Mock(),
        }

    def __getitem__(self, name: str) -> Mock:
        return self._mocks[name]

    def __call__(self, **kwargs: object) -> None:
        with ExitStack() as stack:
            for name, mock in self._mocks.items():
                stack.enter_context(patch(f"{_PIPELINE}.{name}", mock))
            run_scan.run(str(self.attempt_id), str(self.workspace_id), **kwargs)

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


def test_the_soft_time_limit_ends_the_scan_and_still_cleans_up(scan: _Run) -> None:
    scan["extract"].side_effect = SoftTimeLimitExceeded()

    scan()

    scan.ended_with(AnalysisStatus.ERROR, timed_out_message(run_scan.soft_time_limit), ScanErrorCode.SCAN_TIMED_OUT)
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
    scan["extract"].return_value.comments.append(ExtractedComment("A.java", 1, "// TODO: fix this"))
    scan["classify"].side_effect = wrapped

    scan()

    scan.ended_with(AnalysisStatus.ERROR, timed_out_message(run_scan.soft_time_limit), ScanErrorCode.SCAN_TIMED_OUT)
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

    retry.assert_called_once_with(countdown=15)
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
    # Its keys go, and the autoscaler stops counting it.
    scan["progress.clear"].assert_called_once_with(str(scan.attempt_id))
    scan["_sync_demand"].assert_called_once_with(scan.workspace_id)


def test_a_waiting_scan_never_runs_out_of_retries() -> None:
    """`retry(max_retries=None)` means "the task's default", which was 3: the
    fourth slot check raised MaxRetriesExceeded and left the scan queued for
    good. The unlimited wait is declared on the task itself."""
    assert run_scan.max_retries is None


def test_every_slot_check_marks_the_scan_as_held_by_a_worker(scan: _Run) -> None:
    scan["attempts.begin_for_worker"].side_effect = WorkspaceScanSlotBusy

    with patch.object(run_scan, "retry", side_effect=Retry()), pytest.raises(Retry):
        scan()

    scan["progress.mark_waiting"].assert_called_once_with(str(scan.attempt_id), 120)


def test_a_database_error_while_claiming_is_asked_again_later(scan: _Run) -> None:
    from sqlalchemy.exc import OperationalError

    scan["attempts.begin_for_worker"].side_effect = OperationalError("SELECT", {}, Exception("gone"))

    with patch.object(run_scan, "retry", side_effect=Retry()) as retry, pytest.raises(Retry):
        scan(claim_failures=1)

    # A little later each time, and the count travels with the retry.
    retry.assert_called_once_with(countdown=10, kwargs={"claim_failures": 2})
    scan["_set_terminal"].assert_not_called()


def test_a_claim_that_keeps_failing_ends_the_scan_instead_of_leaving_it_queued(
    scan: _Run,
) -> None:
    from sqlalchemy.exc import OperationalError

    scan["attempts.begin_for_worker"].side_effect = OperationalError("SELECT", {}, Exception("gone"))

    with patch.object(run_scan, "retry") as retry:
        scan(claim_failures=4)

    retry.assert_not_called()
    scan.ended_with(AnalysisStatus.ERROR, LOST_MESSAGE)
    scan["progress.clear"].assert_called_once_with(str(scan.attempt_id))
    scan["_sync_demand"].assert_called_once_with(scan.workspace_id)


def test_a_finished_scan_frees_its_autoscaler_slot(scan: _Run) -> None:
    scan()

    scan["_sync_demand"].assert_called_once_with(scan.workspace_id)


def test_ck_running_past_its_own_limit_ends_the_scan_as_timed_out(scan: _Run) -> None:
    scan["extract"].side_effect = CKTimedOut("CK did not finish in time.")

    scan()

    scan.ended_with(
        AnalysisStatus.ERROR,
        timed_out_message(15 * 60),
        ScanErrorCode.SCAN_TIMED_OUT,
    )
    scan["_finalize"].assert_not_called()


def test_the_scan_task_carries_both_time_limits() -> None:
    assert run_scan.soft_time_limit == 30 * 60
    assert run_scan.time_limit == 31 * 60


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
    # The typical duration rides on the first stage. The file total no longer
    # rides on reading_code: it belongs to the reading_comments step.
    assert calls[0].kwargs == {"typical_seconds": 130}
    assert calls[1].kwargs == {}
    # Extraction was handed a file reporter.
    assert callable(scan["extract"].call_args.kwargs["on_file"])


def test_extraction_steps_and_commit_counts_are_published_for_this_attempt(
    scan: _Run,
) -> None:
    scan()

    # `extract` is a mock here, so call the callbacks it was handed.
    # The run's patches are gone by now, so put the same mocks back for the call.
    kwargs = scan["extract"].call_args.kwargs
    with (
        patch(f"{_PIPELINE}.progress.publish_step", scan["progress.publish_step"]),
        patch(f"{_PIPELINE}.progress.publish_commits_done", scan["progress.publish_commits_done"]),
    ):
        kwargs["on_step"]("reading_history", 37, commits_total=1212)
        kwargs["on_commit"](340, 1212)

    attempt_id = str(scan.attempt_id)
    scan["progress.publish_step"].assert_called_once_with(
        attempt_id, "reading_history", 37, commits_total=1212
    )
    scan["progress.publish_commits_done"].assert_called_once_with(attempt_id, 340)


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


@pytest.mark.parametrize("wrapped", [False, True])
def test_persistence_timeout_survives_rollback_and_cleanup_errors(
    scan: _Run, caplog: pytest.LogCaptureFixture, wrapped: bool,
) -> None:
    from sqlalchemy.exc import OperationalError

    timeout = SoftTimeLimitExceeded()
    if wrapped:
        rollback = RuntimeError("another command is already in progress")
        rollback.__context__ = timeout
        failure = OperationalError("ROLLBACK", {}, rollback)
        failure.__cause__ = rollback
        scan["_finalize"].side_effect = failure
    else:
        scan["_finalize"].side_effect = timeout
    scan["cancel.cleanup"].side_effect = RuntimeError("cleanup unavailable")

    scan()

    scan.ended_with(
        AnalysisStatus.ERROR,
        timed_out_message(run_scan.soft_time_limit),
        ScanErrorCode.SCAN_TIMED_OUT,
    )
    timeout_record = next(
        record for record in caplog.records if record.message == "Scan reached its time limit"
    )
    assert timeout_record.stage == "persistence"
    assert timeout_record.exc_info[1] is timeout
    assert "Scan pipeline failed" not in caplog.text
    assert "Scan cleanup failed" in caplog.text


@pytest.mark.parametrize("scan_excluded", [False, True])
def test_exclusions_are_applied_before_detectors_and_keep_production_overrides(
    tmp_path, scan_excluded
):
    for name in [
        "src/main/App.java",
        "src/test/AppTest.java",
        "src/test/Fixture.java",
        ".git/saved.java",
    ]:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("class Example {}")
    scan_pipeline._apply_source_scope(
        tmp_path,
        {
            "test_path_patterns": ["**/src/test/**", ".git/**"],
            "production_path_overrides": ["src/test/Fixture.java"],
            "scan_excluded_directories": scan_excluded,
        },
    )
    assert (tmp_path / "src/main/App.java").exists()
    assert (tmp_path / "src/test/Fixture.java").exists()
    assert (tmp_path / ".git/saved.java").exists()
    assert (tmp_path / "src/test/AppTest.java").exists() is scan_excluded


@pytest.mark.parametrize("mode", ["normal", "ml_unavailable", "all_matched"])
def test_saved_comment_rules_bypass_ml_without_duplicate_findings(scan: _Run, mode: str):
    matched = ExtractedComment("A.java", 1, "// SECURITY-TODO: fix auth")
    other = ExtractedComment("A.java", 2, "// This workaround is fragile")
    config = {"id": str(uuid.uuid4()), "name": "Security TODO", "match_type": "keyword", "pattern": "SECURITY-TODO", "category": "security", "severity": "high", "enabled": True, "case_sensitive": False}
    scan["attempts.begin_for_worker"].return_value = WorkerScanInput("https://github.com/example/repo.git", "a" * 40, "main", source_scope_config={"scan_excluded_directories": True, "comment_rules": [config]})
    scan["extract"].return_value.comments.extend([matched] if mode == "all_matched" else [matched, other])
    if mode == "ml_unavailable":
        scan["classify"].side_effect = MLServiceUnavailable("offline")
    else:
        scan["classify"].return_value = [SATDResult(comment=other, is_debt=True, category=Category.CODE_DESIGN, confidence=0.9, model_version="satd-v1")]
    scan()
    result = scan["_finalize"].call_args.args[2]
    assert len(result.findings) == 1
    assert result.findings[0].evidence == matched.text
    assert result.findings[0].rule_id == "comment-pattern"
    assert result.findings[0].category is Category.SECURITY
    assert result.findings[0].severity.value == "high"
    if mode == "all_matched":
        scan["classify"].assert_not_called()
    else:
        scan["classify"].assert_called_once_with([other])
    assert all(prediction.comment != matched for prediction in result.satd_predictions)


def _scan_finished(caplog: pytest.LogCaptureFixture) -> list:
    return [record for record in caplog.records if record.message == "Scan finished"]


def test_a_finished_scan_logs_one_scan_finished_line(
    scan: _Run, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("INFO", logger=_PIPELINE):
        scan()

    [record] = _scan_finished(caplog)
    assert (record.outcome, record.reason) == ("done", "none")
    assert record.duration_seconds >= 0


def test_a_failed_scan_leaves_its_line_to_set_terminal(
    scan: _Run, caplog: pytest.LogCaptureFixture
) -> None:
    scan["clone_at_commit"].side_effect = CloneError("unreachable")

    with caplog.at_level("INFO", logger=_PIPELINE):
        scan()

    # `_set_terminal` (mocked here) writes the line, so the pipeline adds no "done".
    scan["_set_terminal"].assert_called_once()
    assert _scan_finished(caplog) == []


@pytest.mark.parametrize(
    ("status", "failure_code", "outcome", "reason"),
    [
        (AnalysisStatus.CANCELLED, None, "cancelled", "none"),
        (AnalysisStatus.ERROR, ScanErrorCode.REPOSITORY_TOO_LARGE, "error", "REPOSITORY_TOO_LARGE"),
        (AnalysisStatus.ERROR, "SCAN_FAILED", "error", "SCAN_FAILED"),
    ],
)
def test_every_ending_logs_one_scan_finished_line_with_its_reason(
    caplog: pytest.LogCaptureFixture,
    status: AnalysisStatus,
    failure_code: ScanErrorCode | str | None,
    outcome: str,
    reason: str,
) -> None:
    attempt = SimpleNamespace(start_time=datetime.now(UTC) - timedelta(seconds=90))
    with (
        patch(f"{_PIPELINE}.session_scope", MagicMock()),
        patch(f"{_PIPELINE}.set_workspace_context"),
        patch(f"{_PIPELINE}.attempts.get_worker_attempt", return_value=attempt),
        caplog.at_level("INFO", logger=_PIPELINE),
    ):
        scan_pipeline._set_terminal(uuid.uuid4(), uuid.uuid4(), status, None, failure_code)

    [record] = _scan_finished(caplog)
    assert (record.outcome, record.reason) == (outcome, reason)
    assert 89 <= record.duration_seconds <= 91


def test_a_scan_that_never_started_logs_no_duration(caplog: pytest.LogCaptureFixture) -> None:
    attempt = SimpleNamespace(start_time=None)
    with (
        patch(f"{_PIPELINE}.session_scope", MagicMock()),
        patch(f"{_PIPELINE}.set_workspace_context"),
        patch(f"{_PIPELINE}.attempts.get_worker_attempt", return_value=attempt),
        caplog.at_level("INFO", logger=_PIPELINE),
    ):
        scan_pipeline._set_terminal(
            uuid.uuid4(), uuid.uuid4(), AnalysisStatus.CANCELLED, None
        )

    [record] = _scan_finished(caplog)
    assert record.duration_seconds is None


def test_a_missing_attempt_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    with (
        patch(f"{_PIPELINE}.session_scope", MagicMock()),
        patch(f"{_PIPELINE}.set_workspace_context"),
        patch(f"{_PIPELINE}.attempts.get_worker_attempt", return_value=None),
        caplog.at_level("INFO", logger=_PIPELINE),
    ):
        scan_pipeline._set_terminal(uuid.uuid4(), uuid.uuid4(), AnalysisStatus.ERROR, None)

    assert _scan_finished(caplog) == []
