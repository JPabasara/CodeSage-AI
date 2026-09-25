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
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from codesage_api.config import get_settings
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
    ClassRiskPrediction,
    Finding,
    MLModelVersion,
    ProcessMetric,
    RuleDefinition,
    SATDPrediction,
    Snapshot,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.repositories import attempts, rules
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import session_scope
from codesage_api.detection.fingerprint import (
    satd_fingerprint,
    unique_in_file_order,
)
from codesage_api.detection.reasons import render_satd_reason
from codesage_api.detection.risk import client as risk_client
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding, detect
from codesage_api.detection.rules.registry import from_stored
from codesage_api.detection.satd.client import SATDResult, classify
from codesage_api.detection.satd.severity_markers import assign_severity
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.pipeline import ExtractionResult, extract
from codesage_api.guardrails import (
    STALE_GRACE_SECONDS,
    ScanLimitReached,
    cap_satd_comments,
    check_java_sources,
    git_timed_out_message,
    timed_out_message,
)
from codesage_api.logging import get_logger, scan_context
from codesage_api.scoring.enums import ScanErrorCode
from codesage_api.tasks import cancel, progress
from codesage_api.tasks.app import celery_app
from codesage_api.tasks.repository_clone import (
    CloneTimedOut,
    clone_at_commit,
    clone_path,
    sweep_stale_clones,
)

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class PipelineResults:
    extraction: ExtractionResult
    findings: list[DetectedFinding]
    risk_result: RiskClientResult | None = None
    satd_predictions: list[SATDResult] = field(default_factory=list)


_settings = get_settings()


@celery_app.task(
    bind=True,
    name="codesage.scan",
    # The soft limit raises SoftTimeLimitExceeded inside the task: the scan ends
    # as SCAN_TIMED_OUT and `finally` still deletes the clone. The hard limit is
    # the backstop that kills the process; `expire_stale_running` and
    # `sweep_stale_clones` tidy up after it.
    soft_time_limit=_settings.scan_soft_time_limit_seconds,
    time_limit=_settings.scan_time_limit_seconds,
)
def run_scan(self, attempt_id: str, workspace_id: str) -> None:
    """Execute one analysis attempt end to end.

    Stages, with a cancel check between each:

        1. clone the branch, check out the scanned SHA, read its committer date
        2. guardrails — some Java, but no more than the limits
        3. extract  — CK metrics, PyDriller process metrics, Tree-sitter comments
        4. detect   — rule engine
        5. finalize — one transaction

    At most `max_running_scans_per_workspace` run at once in one workspace;
    the rest stay queued and ask again every `scan_queue_retry_seconds`.
    """
    # Authorization is checked when queued. Role changes do not revoke this job;
    # worker database access remains constrained by the recorded workspace.
    attempt_uuid = uuid.UUID(attempt_id)
    workspace_uuid = uuid.UUID(workspace_id)

    with scan_context(attempt_id):
        try:
            with session_scope() as session:
                set_workspace_context(session, workspace_uuid)
                scan_input = attempts.begin_for_worker(session, workspace_uuid, attempt_uuid)
                stored_rules = rules.list_definitions(session)
        except attempts.WorkspaceScanSlotBusy:
            _wait_for_slot(self, attempt_id, attempt_uuid, workspace_uuid)
            return
        if scan_input is None:
            logger.warning("Scan attempt was not found, or has already ended")
            return
        _run_claimed(attempt_id, attempt_uuid, workspace_uuid, scan_input, stored_rules)


def _wait_for_slot(
    task: Any,
    attempt_id: str,
    attempt_uuid: uuid.UUID,
    workspace_uuid: uuid.UUID,
) -> None:
    """The workspace is at its running limit: stay queued and ask again later.

    A Stop pressed while queued is honoured here, because this attempt never
    reaches a stage boundary where it would otherwise read the flag.
    """
    if progress.is_cancel_requested(attempt_id):
        _set_terminal(attempt_uuid, workspace_uuid, AnalysisStatus.CANCELLED, None)
        progress.clear(attempt_id)
        return
    logger.info("Workspace scan slot busy; the attempt stays queued")
    # No retry cap: a running scan always ends, by itself, at its time limit or
    # through `expire_stale_running`, so the slot is always freed eventually.
    raise task.retry(countdown=_settings.scan_queue_retry_seconds, max_retries=None)


def _run_claimed(
    attempt_id: str,
    attempt_uuid: uuid.UUID,
    workspace_uuid: uuid.UUID,
    scan_input: attempts.WorkerScanInput,
    stored_rules: list[RuleDefinition],
) -> None:
    workspace_id = str(workspace_uuid)
    # Known before cloning, so `finally` deletes it even when the clone itself
    # was interrupted halfway.
    clone_dir = str(clone_path(attempt_uuid))
    try:
        swept = sweep_stale_clones(_settings.scan_time_limit_seconds + STALE_GRACE_SECONDS)
        if swept:
            logger.warning("Removed clones left by killed scans", extra={"count": swept})

        progress.publish_progress(attempt_id, 5)
        cancel.check(attempt_id)
        cloned = clone_at_commit(
            scan_input.repository_url,
            scan_input.commit_sha,
            attempt_uuid,
            branch=scan_input.branch_name,
        )
        clone_dir = str(cloned.path)
        inventory = check_java_sources(cloned.path)
        logger.info(
            "Java sources are within the scan limits",
            extra={"java_files": inventory.files, "java_lines": inventory.lines},
        )
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
            process_by_path = {
                p.path: p
                for p in extracted.process_metrics
            }

            risk_result = risk_client.predict(
                extracted.class_metrics,
                process_by_path,
            )
        except MLServiceUnavailable as exc:
            _reraise_time_limit(exc)
            logger.warning(
                "ML risk service unavailable; scan proceeding in degraded mode",
                extra={"error": str(exc)},
            )

        # ML-1 SATD prediction, over at most `max_satd_comments` comments
        comments = cap_satd_comments(extracted.comments)
        if len(comments) < len(extracted.comments):
            logger.warning(
                "SATD comments capped for this scan",
                extra={"comment_count": len(extracted.comments), "kept": len(comments)},
            )
        try:
            satd_predictions = [
                result for result in classify(comments) if result.is_debt
            ]
        except MLServiceUnavailable as exc:
            _reraise_time_limit(exc)
            logger.warning(
                "SATD classifier unavailable; completing scan in degraded mode",
                extra={"comment_count": len(comments)},
            )
            satd_predictions = []
        progress.publish_progress(attempt_id, 80)
        cancel.check(attempt_id)

        snapshot_id = _finalize(
            attempt_uuid,
            workspace_uuid,
            PipelineResults(
                extracted, findings, risk_result=risk_result, satd_predictions=satd_predictions
            ),
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
    except ScanLimitReached as limit:
        # A clean ending, not a crash: the sentence is the whole story.
        logger.info("Scan ended by a guardrail", extra={"error_code": limit.code.value})
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            limit.message,
            limit.code,
        )
    except SoftTimeLimitExceeded:
        logger.warning("Scan reached its time limit")
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            timed_out_message(),
            ScanErrorCode.SCAN_TIMED_OUT,
        )
    except CloneTimedOut:
        logger.warning("A git command reached its time limit")
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            git_timed_out_message(),
            ScanErrorCode.SCAN_TIMED_OUT,
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


def _reraise_time_limit(exc: BaseException) -> None:
    """The ML clients wrap every exception as MLServiceUnavailable, which would
    turn the soft time limit into degraded mode and let the scan run on into
    the hard kill. Find it in the cause chain and let it end the scan."""
    cause = exc.__cause__
    while cause is not None:
        if isinstance(cause, SoftTimeLimitExceeded):
            raise cause
        cause = cause.__cause__


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

        # Register the exact ML-2 version before storing predictions.  Use the
        # same conflict-safe pattern as ML-1: concurrent scans may observe a new
        # model version at the same time.
        model_version_record: MLModelVersion | None = None
        if (
            results.risk_result
            and (
                results.risk_result.class_scores
                or results.risk_result.file_scores
            )
            and results.risk_result.model_version
        ):
            v_name = results.risk_result.model_version
            session.execute(
                insert(MLModelVersion)
                .values(
                    model_type=MLModelType.BUG_RISK,
                    version_identifier=v_name,
                    training_date=datetime.now(UTC),
                    deployment_status=ModelDeploymentStatus.DEPLOYED,
                    evaluation_dataset_reference="D'Ambros/AEEEM",
                    evaluation_metrics={
                        "registration": "runtime model response",
                    },
                )
                .on_conflict_do_nothing(index_elements=["model_type", "version_identifier"])
            )
            model_version_record = session.scalar(
                select(MLModelVersion).where(
                    MLModelVersion.model_type == MLModelType.BUG_RISK,
                    MLModelVersion.version_identifier == v_name,
                )
            )
            if model_version_record is None:
                raise RuntimeError("Bug-risk model version could not be registered.")

            link = session.get(
                AnalysisEngineModelVersion,
                (attempt.analysis_engine_version_id, model_version_record.id),
            )
            if link is None:
                session.add(
                    AnalysisEngineModelVersion(
                        analysis_engine_version_id=attempt.analysis_engine_version_id,
                        model_version_id=model_version_record.id,
                    )
                )


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
                        number_of_versions_until=(
                            process_metrics.number_of_versions_until
                        ),
                        number_of_authors_until=(
                            process_metrics.number_of_authors_until
                        ),
                        lines_added_until=process_metrics.lines_added_until,
                        max_lines_added_until=process_metrics.max_lines_added_until,
                        avg_lines_added_until=process_metrics.avg_lines_added_until,
                        lines_removed_until=process_metrics.lines_removed_until,
                        max_lines_removed_until=process_metrics.max_lines_removed_until,
                        avg_lines_removed_until=process_metrics.avg_lines_removed_until,
                        code_churn_until=process_metrics.code_churn_until,
                        max_code_churn_until=process_metrics.max_code_churn_until,
                        avg_code_churn_until=process_metrics.avg_code_churn_until,
                        age_with_respect_to=process_metrics.age_with_respect_to,
                        weighted_age_with_respect_to=(
                            process_metrics.weighted_age_with_respect_to
                        ),
                    )
                )

            # Persist ML-2 BugRiskPrediction row if prediction score is present
            if (
                results.risk_result
                and model_version_record
                and metrics.path in results.risk_result.file_scores
            ):
                score = results.risk_result.file_scores[metrics.path]

                session.add(
                    BugRiskPrediction(
                        source_file=source_file,
                        model_version=model_version_record,
                        risk_score=score,
                        # A defect probability is the prediction, not a measure
                        # of uncertainty about that prediction.
                        confidence=None,
                    )
                )

        if results.risk_result and model_version_record:
            for (file_path, class_name), score in sorted(
                results.risk_result.class_scores.items()
            ):
                predicted_source_file = files_by_path.get(file_path)
                if predicted_source_file is None:
                    raise RuntimeError(
                        "A class risk prediction references "
                        f"an unknown source file: {file_path}"
                    )
                session.add(
                    ClassRiskPrediction(
                        source_file=predicted_source_file,
                        model_version=model_version_record,
                        class_name=class_name,
                        risk_score=score,
                        confidence=None,
                    )
                )

        # Comment extraction intentionally scans every Java source file, while
        # CK may omit files it cannot analyse. Preserve valid SATD predictions
        # for those files by creating the source-file fact without inventing
        # static or process metrics.
        for result in results.satd_predictions:
            path = result.comment.file_path
            if path not in files_by_path:
                source_file = SourceFile(
                    snapshot=snapshot,
                    relative_path=path,
                    language="java",
                )
                session.add(source_file)
                session.flush()
                files_by_path[path] = source_file

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
                    class_name=detected.class_name,
                    method_name=detected.method_name,
                )
            )

        model_versions: dict[str, MLModelVersion] = {}
        # One id per finding: the same comment on several lines is several
        # findings, and the dashboard keys every row by its fingerprint.
        satd_fingerprints = unique_in_file_order(
            [
                (
                    satd_fingerprint(result.comment.file_path, result.comment.text),
                    result.comment.file_path,
                    result.comment.line,
                )
                for result in results.satd_predictions
            ]
        )
        for result, fingerprint in zip(
            results.satd_predictions, satd_fingerprints, strict=True
        ):
            if result.category is None:
                raise RuntimeError("A debt prediction is missing its category.")
            finding_file = files_by_path.get(result.comment.file_path)
            if finding_file is None:
                raise RuntimeError(
                    "A SATD prediction references an unknown source file: "
                    f"{result.comment.file_path}"
                )

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
                    .on_conflict_do_nothing(index_elements=["model_type", "version_identifier"])
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
                    fingerprint=fingerprint,
                    class_name=None,
                    method_name=None,
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
    failure_code: ScanErrorCode | None = None,
) -> None:
    with session_scope() as session:
        set_workspace_context(session, workspace_id)
        attempt = attempts.get_worker_attempt(session, workspace_id, attempt_id)
        if attempt is None:
            return
        attempt.status = status
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = failure_information
        attempt.failure_code = failure_code.value if failure_code else None
