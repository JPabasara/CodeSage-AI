"""The scan pipeline write path.

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

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError, OperationalError

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
from codesage_api.detection.comment_rules import match_comments
from codesage_api.detection.fingerprint import (
    satd_fingerprint,
    unique_in_file_order,
)
from codesage_api.detection.provider import ScanContext, run_optional_detector
from codesage_api.detection.reasons import render_satd_reason
from codesage_api.detection.risk import client as risk_client
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding, detect
from codesage_api.detection.rules.registry import from_stored
from codesage_api.detection.satd.client import SATDResult, classify
from codesage_api.detection.satd.severity_markers import assign_severity
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.ck_metrics import CKTimedOut
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
from codesage_api.scoring.enums import ScanErrorCode, ScanStage
from codesage_api.source_scope import classify_source_scope, is_excluded_path
from codesage_api.tasks import cancel, progress
from codesage_api.tasks.app import celery_app
from codesage_api.tasks.repository_clone import (
    CloneError,
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
    soft_time_limit=_settings.scan_soft_time_limit_seconds,
    time_limit=_settings.scan_time_limit_seconds,
    # A scan waits for its workspace's slot as long as the queue ahead of it
    # takes. On `retry()`, max_retries=None means "the task's default", so the
    # unlimited wait has to be declared here, on the task.
    max_retries=None,
)
def run_scan(self, attempt_id: str, workspace_id: str, claim_failures: int = 0) -> None:
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
    attempt_uuid = uuid.UUID(attempt_id)
    workspace_uuid = uuid.UUID(workspace_id)

    with scan_context(attempt_id):
        # This worker holds the attempt: it is not lost, whatever happens next.
        progress.mark_waiting(attempt_id, _settings.scan_queue_heartbeat_seconds)
        try:
            with session_scope() as session:
                set_workspace_context(session, workspace_uuid)
                scan_input = attempts.begin_for_worker(session, workspace_uuid, attempt_uuid)
                stored_rules = rules.list_definitions(session)
        except attempts.WorkspaceScanSlotBusy:
            _wait_for_slot(self, attempt_id, attempt_uuid, workspace_uuid)
            return
        except (OperationalError, DBAPIError) as exc:
            _retry_claim(self, attempt_id, attempt_uuid, workspace_uuid, claim_failures, exc)
            return
        if scan_input is None:
            logger.warning("Scan attempt was not found, or has already ended")
            progress.clear(attempt_id)
            _sync_demand(workspace_uuid)
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
        _sync_demand(workspace_uuid)
        return
    logger.info("Workspace scan slot busy; the attempt stays queued")
    # Unlimited by the task's own max_retries; see `run_scan`.
    raise task.retry(countdown=_settings.scan_queue_retry_seconds)


def _retry_claim(
    task: Any,
    attempt_id: str,
    attempt_uuid: uuid.UUID,
    workspace_uuid: uuid.UUID,
    claim_failures: int,
    error: BaseException,
) -> None:
    """The database failed while claiming a slot: a dropped connection, a deadlock.

    Asked again a few times, a little later each time. If it keeps failing the
    scan ends with a sentence the user can act on, instead of staying queued
    with nobody left to run it.
    """
    failures = claim_failures + 1
    if failures < _settings.scan_claim_attempts:
        logger.warning(
            "Database error while claiming a scan slot; trying again",
            extra={"failures": failures, "error": type(error).__name__},
        )
        raise task.retry(
            countdown=min(60, 5 * 2**claim_failures),
            kwargs={"claim_failures": failures},
        )
    logger.error(
        "Could not claim a scan slot; ending the scan",
        exc_info=(type(error), error, error.__traceback__),
    )
    try:
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            attempts.LOST_MESSAGE,
        )
    except Exception:
        # The database is still away: the lost-scan check ends it once it is back.
        logger.exception("Could not record the failed claim")
    progress.clear(attempt_id)
    _sync_demand(workspace_uuid)


def _sync_demand(workspace_uuid: uuid.UUID) -> None:
    """Tell the autoscaler how many slots this workspace still needs. Best effort:
    the API corrects it on its next read of the workspace's scans."""
    try:
        with session_scope() as session:
            set_workspace_context(session, workspace_uuid)
            slots = min(
                attempts.count_active_in_workspace(session, workspace_uuid),
                _settings.max_running_scans_per_workspace,
            )
    except Exception:
        logger.exception("Could not refresh the scan demand")
        return
    progress.sync_scan_demand(str(workspace_uuid), slots)


FILE_REPORTS_PER_SCAN = 50


def _file_reporter(attempt_id: str) -> Callable[[int, int], None]:
    """`on_file` for extraction: publish every ~2% of files, and the last one."""

    def report(done: int, total: int) -> None:
        step = max(1, total // FILE_REPORTS_PER_SCAN)
        if done == total or done % step == 0:
            progress.publish_files_done(attempt_id, done)

    return report


def _apply_source_scope(repository_path: Path, scope: dict[str, Any] | None) -> None:
    """Apply exclusions only to the worker's disposable checkout, before any detector."""
    if scope is None or scope["scan_excluded_directories"]:
        return
    for path in repository_path.rglob("*.java"):
        relative = path.relative_to(repository_path)
        if ".git" in relative.parts:
            continue
        if is_excluded_path(relative.as_posix(), scope["test_path_patterns"], scope["production_path_overrides"]):
            path.unlink()


def _run_claimed(
    attempt_id: str,
    attempt_uuid: uuid.UUID,
    workspace_uuid: uuid.UUID,
    scan_input: attempts.WorkerScanInput,
    stored_rules: list[RuleDefinition],
) -> None:
    started = time.monotonic()
    workspace_id = str(workspace_uuid)
    clone_dir = str(clone_path(attempt_uuid))
    stage = "cloning"
    try:
        swept = sweep_stale_clones(_settings.scan_time_limit_seconds + STALE_GRACE_SECONDS)
        if swept:
            logger.warning("Removed clones left by killed scans", extra={"count": swept})

        progress.publish_stage(
            attempt_id,
            ScanStage.CLONING,
            5,
            typical_seconds=scan_input.typical_seconds,
        )
        cancel.check(attempt_id)
        cloned = clone_at_commit(
            scan_input.repository_url,
            scan_input.commit_sha,
            attempt_uuid,
            branch=scan_input.branch_name,
        )
        clone_dir = str(cloned.path)
        _apply_source_scope(cloned.path, scan_input.source_scope_config)
        inventory = check_java_sources(cloned.path)
        logger.info(
            "Java sources are within the scan limits",
            extra={"java_files": inventory.files, "java_lines": inventory.lines},
        )
        # The file count belongs to the `reading_comments` step, not the stage.
        progress.publish_stage(attempt_id, ScanStage.READING_CODE, 25)
        cancel.check(attempt_id)

        stage = "extraction"
        extracted = extract(
            cloned.path,
            cloned.commit_sha,
            cloned.committer_date,
            on_file=_file_reporter(attempt_id),
            on_step=partial(progress.publish_step, attempt_id),
            on_commit=lambda done, _total: progress.publish_commits_done(attempt_id, done),
        )
        progress.publish_stage(attempt_id, ScanStage.FINDING_DEBT, 60)
        cancel.check(attempt_id)

        stage = "detection"
        disabled_rule_ids = set((scan_input.source_scope_config or {}).get("disabled_rule_ids", []))
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
                for rule in stored_rules if rule.rule_id not in disabled_rule_ids
            ],
            cloned.path,
            extracted.method_metrics,
        )
        optional_detection = run_optional_detector(
            cloned.path,
            ScanContext(attempt_id=attempt_id, disabled_rule_ids=tuple(sorted(disabled_rule_ids))),
        )
        findings.extend(item for item in optional_detection.findings if item.rule_id not in disabled_rule_ids)
        logger.info(
            "Optional detector completed",
            extra={
                "detector_status": optional_detection.status.value,
                "detector_findings": len(optional_detection.findings),
                "detector_diagnostics": [item.code for item in optional_detection.diagnostics],
                **optional_detection.metadata,
            },
        )
        cancel.check(attempt_id)

        # ML-2 Risk Model prediction with graceful degradation
        progress.publish_stage(attempt_id, ScanStage.PREDICTING_RISK, 70)
        stage = "risk_prediction"
        risk_result: RiskClientResult | None = None
        try:
            process_by_path = {p.path: p for p in extracted.process_metrics}

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

        # Explicit workspace markers are tracked without relying on an ML decision.
        matched_comments, unmatched_comments = match_comments(
            extracted.comments, (scan_input.source_scope_config or {}).get("comment_rules", []),
        )
        findings.extend(matched_comments)
        # ML-1 SATD prediction, over at most `max_satd_comments` unmatched comments
        stage = "satd_prediction"
        comments = cap_satd_comments(unmatched_comments)
        if len(comments) < len(unmatched_comments):
            logger.warning(
                "SATD comments capped for this scan",
                extra={"comment_count": len(unmatched_comments), "kept": len(comments)},
            )
        try:
            satd_predictions = [result for result in classify(comments) if result.is_debt] if comments else []
        except MLServiceUnavailable as exc:
            _reraise_time_limit(exc)
            logger.warning(
                "SATD classifier unavailable; completing scan in degraded mode",
                extra={"comment_count": len(comments)},
            )
            satd_predictions = []
        progress.publish_stage(attempt_id, ScanStage.SCORING, 85)
        cancel.check(attempt_id)

        stage = "persistence"
        snapshot_id = _finalize(
            attempt_uuid,
            workspace_uuid,
            PipelineResults(
                extracted, findings, risk_result=risk_result, satd_predictions=satd_predictions
            ),
        )
        stage = "finishing"
        progress.publish_stage(attempt_id, ScanStage.FINISHING, 97)
        try:
            celery_app.send_task(
                "codesage.warm_snapshot_score",
                args=[str(snapshot_id), workspace_id],
            )
        except Exception:
            logger.exception("Could not enqueue snapshot score warm-up")
        _log_scan_finished(AnalysisStatus.DONE, None, time.monotonic() - started)
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
    except SoftTimeLimitExceeded as exc:
        _record_timeout(attempt_uuid, workspace_uuid, stage, exc)
    except CKTimedOut:
        logger.warning("CK reached its time limit")
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            timed_out_message(_settings.ck_timeout_seconds),
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
    except CloneError:
        logger.exception("Repository clone failed")
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            "The repository could not be analysed.",
        )
    except Exception as exc:
        # SQLAlchemy/psycopg may wrap a soft timeout in a rollback error.
        timeout = _find_time_limit(exc)
        if timeout is not None:
            _record_timeout(attempt_uuid, workspace_uuid, stage, timeout)
        else:
            logger.exception("Scan pipeline failed", extra={"stage": stage})
            _set_terminal(
                attempt_uuid,
                workspace_uuid,
                AnalysisStatus.ERROR,
                "The repository could not be analysed.",
                failure_code="SCAN_FAILED",
            )
    finally:
        try:
            cancel.cleanup(attempt_id, clone_dir)
        except Exception:
            logger.exception("Scan cleanup failed", extra={"stage": stage})
        _sync_demand(workspace_uuid)


def _find_time_limit(exc: BaseException) -> SoftTimeLimitExceeded | None:
    """Find timeouts even when rollback wraps them via cause or context."""
    pending = [exc]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, SoftTimeLimitExceeded):
            return current
        for previous in (current.__cause__, current.__context__):
            if previous is not None:
                pending.append(previous)
    return None


def _reraise_time_limit(exc: BaseException) -> None:
    timeout = _find_time_limit(exc)
    if timeout is not None:
        raise timeout


def _record_timeout(
    attempt_uuid: uuid.UUID,
    workspace_uuid: uuid.UUID,
    stage: str,
    timeout: SoftTimeLimitExceeded,
) -> None:
    logger.warning(
        "Scan reached its time limit",
        extra={"stage": stage, "error_code": ScanErrorCode.SCAN_TIMED_OUT.value},
        exc_info=(type(timeout), timeout, timeout.__traceback__),
    )
    try:
        _set_terminal(
            attempt_uuid,
            workspace_uuid,
            AnalysisStatus.ERROR,
            timed_out_message(_settings.scan_soft_time_limit_seconds),
            ScanErrorCode.SCAN_TIMED_OUT,
        )
    except Exception as record_error:
        logger.exception("Could not record scan timeout", extra={"stage": stage})
        raise timeout from record_error


def _finalize(
    attempt_id: uuid.UUID,
    workspace_id: uuid.UUID,
    results: PipelineResults,
) -> uuid.UUID:
    """Commit everything as a finalized result, or nothing at all.

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

        scope = attempt.source_scope_config or {
            "test_path_patterns": attempt.branch.repository.test_path_patterns,
            "production_path_overrides": attempt.branch.repository.production_path_overrides,
        }

        snapshot = Snapshot(
            analysis_attempt=attempt,
            commit_sha=attempt.commit_sha,
            scan_time=datetime.now(UTC),
            finding_count=len(results.findings) + len(results.satd_predictions),
        )
        session.add(snapshot)
        session.flush()

        model_version_record: MLModelVersion | None = None
        if (
            results.risk_result
            and (results.risk_result.class_scores or results.risk_result.file_scores)
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

        process_by_path = {item.path: item for item in results.extraction.process_metrics}

        files_by_path: dict[str, SourceFile] = {}
        for metrics in results.extraction.static_metrics:
            source_file = SourceFile(
                snapshot=snapshot,
                relative_path=metrics.path,
                language="java",
                source_scope=classify_source_scope(
                    metrics.path,
                    scope["test_path_patterns"],
                    scope["production_path_overrides"],
                ),
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
                        number_of_versions_until=(process_metrics.number_of_versions_until),
                        number_of_authors_until=(process_metrics.number_of_authors_until),
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
                        weighted_age_with_respect_to=(process_metrics.weighted_age_with_respect_to),
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
                        confidence=None,
                    )
                )

        if results.risk_result and model_version_record:
            for (file_path, class_name), score in sorted(results.risk_result.class_scores.items()):
                predicted_source_file = files_by_path.get(file_path)
                if predicted_source_file is None:
                    raise RuntimeError(
                        f"A class risk prediction references an unknown source file: {file_path}"
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

        for detected in results.findings:
            if detected.file_path not in files_by_path:
                source_file = SourceFile(
                    snapshot=snapshot,
                    relative_path=detected.file_path,
                    language="java",
                    source_scope=classify_source_scope(
                        detected.file_path,
                        scope["test_path_patterns"],
                        scope["production_path_overrides"],
                    ),
                )
                session.add(source_file)
                session.flush()
                files_by_path[detected.file_path] = source_file

        for result in results.satd_predictions:
            path = result.comment.file_path
            if path not in files_by_path:
                source_file = SourceFile(
                    snapshot=snapshot,
                    relative_path=path,
                    language="java",
                    source_scope=classify_source_scope(
                        path,
                        scope["test_path_patterns"],
                        scope["production_path_overrides"],
                    ),
                )
                session.add(source_file)
                session.flush()
                files_by_path[path] = source_file

        rule_fingerprints = unique_in_file_order(
            [(item.fingerprint, item.file_path, item.line) for item in results.findings]
        )
        for detected, fingerprint in zip(results.findings, rule_fingerprints, strict=True):
            finding_file = files_by_path[detected.file_path]
            location = SourceLocation(
                source_file=finding_file,
                code_symbol=None,
                start_line=detected.line,
                end_line=detected.end_line or detected.line,
                start_column=detected.begin_column,
                end_column=detected.end_column,
            )
            session.add(location)
            session.flush()
            session.add(
                Finding(
                    snapshot_id=snapshot.id,
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
                    fingerprint=fingerprint,
                    class_name=detected.class_name,
                    method_name=detected.method_name,
                )
            )

        model_versions: dict[str, MLModelVersion] = {}
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
        for result, fingerprint in zip(results.satd_predictions, satd_fingerprints, strict=True):
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
                    snapshot_id=snapshot.id,
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
        attempt.failure_code = None
        return snapshot.id


def _set_terminal(
    attempt_id: uuid.UUID,
    workspace_id: uuid.UUID,
    status: AnalysisStatus,
    failure_information: str | None,
    failure_code: ScanErrorCode | str | None = None,
) -> None:
    with session_scope() as session:
        set_workspace_context(session, workspace_id)
        attempt = attempts.get_worker_attempt(session, workspace_id, attempt_id)
        if attempt is None:
            return
        attempt.status = status
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = failure_information
        attempt.failure_code = (
            failure_code.value if isinstance(failure_code, ScanErrorCode) else failure_code
        )
        reason = attempt.failure_code
        duration = (
            (attempt.completion_time - attempt.start_time).total_seconds()
            if attempt.start_time is not None
            else None
        )
    # Logged once the ending is committed, never for one that was rolled back.
    _log_scan_finished(status, reason, duration)


def _log_scan_finished(
    status: AnalysisStatus, reason: str | None, duration_seconds: float | None
) -> None:
    # Grafana dashboards count this line: keep the message and the field names.
    logger.info(
        "Scan finished",
        extra={
            "outcome": status.value,
            "reason": reason or "none",
            "duration_seconds": (
                round(duration_seconds, 1) if duration_seconds is not None else None
            ),
        },
    )
