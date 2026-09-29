import uuid
from unittest.mock import Mock, patch

from codesage_api.db.enums import AnalysisStatus, AnalysisTriggerType, Severity
from codesage_api.db.models import AnalysisAttempt, Finding, Snapshot, SourceFile
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.extractors.pipeline import ExtractionResult
from codesage_api.scoring.enums import Category
from codesage_api.tasks.scan_pipeline import PipelineResults, _finalize


@patch("codesage_api.tasks.scan_pipeline.set_workspace_context")
@patch("codesage_api.tasks.scan_pipeline.attempts.get_worker_attempt")
@patch("codesage_api.tasks.scan_pipeline.session_scope")
def test_detector_finding_survives_when_ck_omits_its_source_file(
    session_scope: Mock,
    get_attempt: Mock,
    _set_workspace: Mock,
) -> None:
    get_attempt.return_value = AnalysisAttempt(
        id=uuid.uuid4(),
        branch_id=uuid.uuid4(),
        analysis_engine_version_id=uuid.uuid4(),
        commit_sha="a" * 40,
        trigger_type=AnalysisTriggerType.MANUAL,
        status=AnalysisStatus.RUNNING,
        retry_count=0,
    )
    session = session_scope.return_value.__enter__.return_value
    session.scalar.return_value = None
    session.get.return_value = None

    def assign_snapshot_id() -> None:
        added = [call.args[0] for call in session.add.call_args_list]
        for item in added:
            if isinstance(item, Snapshot) and item.id is None:
                item.id = uuid.uuid4()

    session.flush.side_effect = assign_snapshot_id
    finding = DetectedFinding(
        file_path="src/generated/Skipped.java",
        line=7,
        end_line=9,
        begin_column=4,
        end_column=17,
        symbol="Skipped.work",
        rule_id="replacement:unsafe-work",
        category=Category.CODE_DESIGN,
        severity=Severity.MEDIUM,
        description="Unsafe work",
        evidence="replacement detector",
        measured_value=None,
        threshold=None,
        fingerprint="replacement-fingerprint",
        class_name="org.example.Skipped",
        method_name="work",
    )

    _finalize(
        get_attempt.return_value.id,
        uuid.uuid4(),
        PipelineResults(ExtractionResult([], [], [], []), [finding]),
    )

    added = [call.args[0] for call in session.add.call_args_list]
    snapshot = next(item for item in added if isinstance(item, Snapshot))
    source_file = next(item for item in added if isinstance(item, SourceFile))
    stored_finding = next(item for item in added if isinstance(item, Finding))
    location = stored_finding.source_location
    assert source_file.relative_path == "src/generated/Skipped.java"
    assert stored_finding.snapshot_id == snapshot.id
    assert (stored_finding.class_name, stored_finding.method_name) == (
        "org.example.Skipped",
        "work",
    )
    assert location.source_file is source_file
    assert (location.start_line, location.end_line) == (7, 9)
    assert (location.start_column, location.end_column) == (4, 17)
