"""The scan pipeline — the write path (SRS FR-6, FR-7, FR-8, FR-9, FR-10, FR-21).

    clone → extract → detect → finalize

**The analysis write path ends at "finalize". Scoring is not a scan stage.** A
successful scan only queues a separate score-cache task after its immutable facts
commit. Profile changes can therefore re-score existing snapshots without a scan.

**The worker never calls the API.** It records phase by writing to
ANALYSIS_ATTEMPT and progress by publishing to Redis; the API serves the polling
client from those two sources. That keeps the dependency direction one-way and
matches the deployment view.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from codesage_api.db.enums import (
    AnalysisStatus,
    FindingSource,
    MLModelType,
    ModelDeploymentStatus,
    Severity,
)
from codesage_api.db.models import (
    AnalysisEngineModelVersion,
    BugRiskPrediction,
    Finding,
    MLModelVersion,
    ProcessMetric,
    SATDPrediction,
    Snapshot,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.repositories import attempts, rules
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import session_scope
from codesage_api.detection.fingerprint import satd_fingerprint
from codesage_api.detection.reasons import render_satd_reason
from codesage_api.detection.risk import client as risk_client
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding, detect
from codesage_api.detection.rules.registry import from_stored
from codesage_api.detection.satd.client import SATDResult, classify
from codesage_api.detection.satd.severity_markers import assign_severity
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.pipeline import ExtractionResult, extract
from codesage_api.logging import get_logger, scan_context
from codesage_api.tasks import cancel, progress
from codesage_api.tasks.app import celery_app
from codesage_api.tasks.repository_clone import clone_at_commit

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class PipelineResults:
    extraction: ExtractionResult
    findings: list[DetectedFinding]
    risk_result: RiskClientResult | None = None
    satd_predictions: list[SATDResult] = field(default_factory=list)


@celery_app.task(bind=True, name="codesage.scan")
def run_scan(self, attempt_id: str, workspace_id: str) -> None:
    """Execute one analysis attempt end to end.

    Stages, with a cancel check between each:

        1. clone at the scanned SHA, read its committer date
        2. extract  — CK metrics, PyDriller process metrics, Tree-sitter comments
        3. detect   — rule engine
        4. finalize — one transaction
    """
    attempt_uuid = uuid.UUID(attempt_id)
    workspace_uuid = uuid.UUID(workspace_id)
    clone_dir: str | None = None

    with scan_context(attempt_id):
        try:
            with session_scope() as session:
                set_workspace_context(session, workspace_uuid)
                scan_input = attempts.begin_for_worker(
                    session, workspace_uuid, attempt_uuid
                )
                stored_rules = rules.list_definitions(session)
            if scan_input is None:
                logger.error("Scan attempt was not found in its workspace")
                return

            progress.publish_progress(attempt_id, 5)
            cancel.check(attempt_id)
            cloned = clone_at_commit(
                scan_input.repository_url,
                scan_input.commit_sha,
                attempt_uuid,
            )
            clone_dir = str(cloned.path)
            progress.publish_progress(attempt_id, 25)
            cancel.check(attempt_id)

            extracted = extract(
                cloned.path,
                cloned.commit_sha,
                cloned.committer_date,
            )
            progress.publish_progress(attempt_id, 60)
            cancel.check(attempt_id)

            findings = detect(
                extracted.static_metrics,
                [
                    from_stored(
                        rule_id=rule.rule_id,
                        category_id=rule.category_id,
                        severity=rule.severity.value,
                        threshold=rule.threshold,
                        message_template=rule.message_template,
                    )
                    for rule in stored_rules
                ],
                cloned.path,
                extracted.method_metrics,
            )

            # ML-2 Risk Model prediction with graceful degradation
            risk_result: RiskClientResult | None = None
            try:
                process_by_path = {p.path: p for p in extracted.process_metrics}
                risk_result = risk_client.predict(
                    extracted.static_metrics, process_by_path
                )
            except MLServiceUnavailable as exc:
                logger.warning(
                    "ML risk service unavailable; scan proceeding in degraded mode",
                    extra={"error": str(exc)},
                )

            # ML-1 SATD prediction
            try:
                satd_predictions = [
                    result for result in classify(extracted.comments) if result.is_debt
                ]
            except MLServiceUnavailable:
                logger.warning(
                    "SATD classifier unavailable; completing scan in degraded mode",
                    extra={"comment_count": len(extracted.comments)},
                )
                satd_predictions = []
            progress.publish_progress(attempt_id, 80)
            cancel.check(attempt_id)

            snapshot_id = _finalize(
                attempt_uuid,
                workspace_uuid,
                PipelineResults(extracted, findings, risk_result=risk_result, satd_predictions=satd_predictions),
            )
            progress.publish_progress(attempt_id, 100)
            try:
                celery_app.send_task(
                    "codesage.warm_snapshot_score",
                    args=[str(snapshot_id), workspace_id],
                )
            except Exception:
                logger.exception("Could not enqueue snapshot score warm-up")
        except cancel.ScanCancelled:
            _set_terminal(
                attempt_uuid,
                workspace_uuid,
                AnalysisStatus.CANCELLED,
                None,
            )
        except Exception:
            logger.exception("Scan pipeline failed")
            _set_terminal(
                attempt_uuid,
                workspace_uuid,
                AnalysisStatus.ERROR,
                "The repository could not be analysed.",
            )
        finally:
            cancel.cleanup(attempt_id, clone_dir)


def _finalize(
    attempt_id: uuid.UUID,
    workspace_id: uuid.UUID,
    results: PipelineResults,
) -> uuid.UUID:
    """Commit everything as a finalized result, or nothing at all (DBR-22, REL-05).

    Separated from `run_scan` so the transactional boundary is a single, obvious
    function rather than an indented block two hundred lines into a task.
    """
    with session_scope() as session:
        set_workspace_context(session, workspace_id)
        attempt = attempts.get_worker_attempt(session, workspace_id, attempt_id)
        if attempt is None:
            raise RuntimeError("Analysis attempt disappeared before finalization.")
        if attempt.snapshot is not None:
            raise RuntimeError("Analysis attempt has already been finalized.")

        snapshot = Snapshot(
            analysis_attempt=attempt,
            commit_sha=attempt.commit_sha,
            scan_time=datetime.now(UTC),
            finding_count=len(results.findings) + len(results.satd_predictions),
        )
        session.add(snapshot)
        session.flush()

        # Look up or insert MLModelVersion if risk predictions were generated
        model_version_record: MLModelVersion | None = None
        if results.risk_result and results.risk_result.model_version:
            v_name = results.risk_result.model_version
            stmt = select(MLModelVersion).where(MLModelVersion.version == v_name)
            model_version_record = session.scalars(stmt).first()
            if model_version_record is None:
                model_version_record = MLModelVersion(
                    model_type="risk",
                    version=v_name,
                )
                session.add(model_version_record)
                session.flush()

        process_by_path = {
            item.path: item for item in results.extraction.process_metrics
        }
        files_by_path: dict[str, SourceFile] = {}
        for metrics in results.extraction.static_metrics:
            source_file = SourceFile(
                snapshot=snapshot,
                relative_path=metrics.path,
                language="java",
            )
            session.add(source_file)
            session.flush()
            files_by_path[metrics.path] = source_file
            session.add_all(
                [
                    StaticMetric(
                        source_file=source_file,
                        code_symbol=None,
                        metric_name=name,
                        value=value,
                    )
                    for name, value in (
                        ("loc", float(metrics.loc)),
                        ("wmc", metrics.cyclomatic_complexity),
                        ("max_nested_blocks", float(metrics.max_nesting_depth)),
                        ("total_methods", float(metrics.method_count)),
                        ("longest_method_loc", float(metrics.longest_method_lines)),
                    )
                ]
            )
            if (process_metrics := process_by_path.get(metrics.path)) is not None:
                session.add(
                    ProcessMetric(
                        source_file=source_file,
                        commits_90d=process_metrics.commits_90d,
                        author_count=process_metrics.author_count,
                        file_age=process_metrics.file_age_days,
                        recency=process_metrics.recency_days,
                    )
                )

            # Persist ML-2 BugRiskPrediction row if prediction score is present
            if (
                results.risk_result
                and model_version_record
                and metrics.path in results.risk_result.scores
            ):
                score = results.risk_result.scores[metrics.path]
                session.add(
                    BugRiskPrediction(
                        source_file=source_file,
                        model_version=model_version_record,
                        risk_score=score,
                        confidence=score,
                    )
                )

        for detected in results.findings:
            finding_file = files_by_path.get(detected.file_path)
            if finding_file is None:
                raise RuntimeError("A finding references an unknown source file.")
            location = SourceLocation(
                source_file=finding_file,
                code_symbol=None,
                start_line=detected.line,
                end_line=detected.line,
                start_column=0,
                end_column=0,
            )
            session.add(location)
            session.flush()
            session.add(
                Finding(
                    source_location=location,
                    category_id=detected.category.value,
                    rule_id=detected.rule_id,
                    satd_prediction_id=None,
                    source=FindingSource.RULE,
                    severity=Severity(detected.severity.value),
                    description=detected.description,
                    evidence=detected.evidence,
                    measured_value=detected.measured_value,
                    threshold=detected.threshold,
                    confidence=None,
                    fingerprint=detected.fingerprint,
                )
            )

        model_versions: dict[str, MLModelVersion] = {}
        for result in results.satd_predictions:
            if result.category is None:
                raise RuntimeError("A debt prediction is missing its category.")
            finding_file = files_by_path.get(result.comment.file_path)
            if finding_file is None:
                raise RuntimeError("A SATD prediction references an unknown source file.")

            model_version = model_versions.get(result.model_version)
            if model_version is None:
                session.execute(
                    insert(MLModelVersion)
                    .values(
                        model_type=MLModelType.SATD,
                        version_identifier=result.model_version,
                        training_date=datetime.now(UTC),
                        deployment_status=ModelDeploymentStatus.DEPLOYED,
                        evaluation_dataset_reference=(
                            "SATDAUG data-augmentation-code_comments.csv"
                        ),
                        evaluation_metrics={"registration": "runtime model response"},
                    )
                    .on_conflict_do_nothing(
                        index_elements=["model_type", "version_identifier"]
                    )
                )
                model_version = session.scalar(
                    select(MLModelVersion).where(
                        MLModelVersion.model_type == MLModelType.SATD,
                        MLModelVersion.version_identifier == result.model_version,
                    )
                )
                if model_version is None:
                    raise RuntimeError("SATD model version could not be registered.")
                model_versions[result.model_version] = model_version

                link = session.get(
                    AnalysisEngineModelVersion,
                    (attempt.analysis_engine_version_id, model_version.id),
                )
                if link is None:
                    session.add(
                        AnalysisEngineModelVersion(
                            analysis_engine_version_id=attempt.analysis_engine_version_id,
                            model_version_id=model_version.id,
                        )
                    )

            location = SourceLocation(
                source_file=finding_file,
                code_symbol=None,
                start_line=result.comment.line,
                end_line=result.comment.line,
                start_column=0,
                end_column=0,
            )
            session.add(location)
            session.flush()
            marker = assign_severity(result.comment.text)
            description = render_satd_reason(
                marker.message_template,
                comment_text=result.comment.text,
                predicted_category=result.category.value,
            )
            prediction = SATDPrediction(
                source_location=location,
                category_id=result.category.value,
                model_version=model_version,
                is_debt=True,
                confidence=result.confidence,
                explanation=description,
            )
            session.add(prediction)
            session.flush()
            session.add(
                Finding(
                    source_location=location,
                    category_id=result.category.value,
                    rule_id=None,
                    satd_prediction=prediction,
                    source=FindingSource.SATD,
                    severity=Severity(marker.severity.value),
                    description=description,
                    evidence=result.comment.text,
                    measured_value=None,
                    threshold=None,
                    confidence=result.confidence,
                    fingerprint=satd_fingerprint(
                        result.comment.file_path, result.comment.text
                    ),
                )
            )

        attempt.status = AnalysisStatus.DONE
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = None
        return snapshot.id


def _set_terminal(
    attempt_id: uuid.UUID,
    workspace_id: uuid.UUID,
    status: AnalysisStatus,
    failure_information: str | None,
) -> None:
    with session_scope() as session:
        set_workspace_context(session, workspace_id)
        attempt = attempts.get_worker_attempt(session, workspace_id, attempt_id)
        if attempt is None:
            return
        attempt.status = status
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = failure_information
