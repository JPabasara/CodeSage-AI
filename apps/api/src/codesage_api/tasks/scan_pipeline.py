"""The scan pipeline — the write path (SRS FR-6, FR-7, FR-8, FR-9, FR-10, FR-21).

    clone → extract → detect → finalize

**The write path ends at "finalize". Scoring is not a pipeline stage.** It happens
later, in the API process, every time the dashboard is requested. If scoring ran
here, every profile change would require re-scanning every snapshot — which is
precisely the thing FR-20 promises never happens. The `workers never score` import
contract in pyproject.toml enforces this mechanically.

**The worker never calls the API.** It records phase by writing to
ANALYSIS_ATTEMPT and progress by publishing to Redis; the API serves the polling
client from those two sources. That keeps the dependency direction one-way and
matches the deployment view.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select

from codesage_api.db.enums import AnalysisStatus, FindingSource, Severity
from codesage_api.db.models import (
    BugRiskPrediction,
    Finding,
    MLModelVersion,
    ProcessMetric,
    Snapshot,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.repositories import attempts, rules
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import session_scope
from codesage_api.detection.risk import client as risk_client
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding, detect
from codesage_api.detection.rules.registry import from_stored
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


@celery_app.task(bind=True, name="codesage.scan")
def run_scan(self, attempt_id: str, workspace_id: str) -> None:
    """Execute one analysis attempt end to end.

    Stages, with a cancel check between each:

        1. clone at the scanned SHA, read its committer date
        2. extract  — CK metrics, PyDriller process metrics, Tree-sitter comments
        3. detect   — rule engine; then ML-1 and ML-2 (independent, may be issued
                      together, and skipped together if the service is down)
        4. finalize — one transaction: Snapshot + files + metrics + findings +
                      predictions, atomically (DBR-22)

    **The cancel check sits BETWEEN stages, never inside stage 4.** Once
    finalization begins the worker completes it, because a killed write would leave
    a partial snapshot and FR-6 requires the previous snapshot to survive a
    cancellation intact. The cost is that a user who presses Stop waits until the
    current stage ends.

    **Degraded mode.** If the ML container is unreachable, the attempt still
    finalizes: all rule and security findings present, no SATD findings, every
    risk_score 0.0 so risk_factor falls back to 1.0 and boosts nothing. Both models
    live in one container, so they are reachable or unreachable together.

    **On failure** the worker writes phase `error` and the reason onto the attempt
    row — stored, not merely logged, per SP-13. Nothing was written to Snapshot, so
    the previous snapshot is untouched and remains what the dashboard shows.

    Every log line inside this task carries the attempt id, via `scan_context`, so
    one scan is traceable across the API, the broker, the worker and the ML service.
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

            progress.publish_progress(attempt_id, 80)
            cancel.check(attempt_id)

            _finalize(
                attempt_uuid,
                workspace_uuid,
                PipelineResults(extracted, findings, risk_result),
            )
            progress.publish_progress(attempt_id, 100)
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
) -> None:
    """Commit everything as a finalized result, or nothing at all (DBR-22, REL-05)."""
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
            finding_count=len(results.findings),
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

        attempt.status = AnalysisStatus.DONE
        attempt.completion_time = datetime.now(UTC)
        attempt.failure_information = None


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
