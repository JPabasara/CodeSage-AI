from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.config import get_settings
from codesage_api.db.models import Finding, Snapshot, SnapshotScore, SourceFile
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.detection.fingerprint import unique_in_file_order
from codesage_api.errors import NotFound, ScorePending
from codesage_api.schemas import (
    CategoryBreakdownItemOut,
    FileScoreOut,
    FindingOut,
    FindingPageOut,
    HealthPointOut,
    HealthReportOut,
    LatestHealthOut,
    ScanSummaryOut,
    TreeNodeOut,
)
from codesage_api.schemas.health import (
    CalibrationCountsOut,
    CalibrationRecordOut,
    FindingSummaryOut,
    SeverityCountsOut,
)
from codesage_api.scoring import formula
from codesage_api.scoring.cache import (
    SCORING_ENGINE_VERSION,
    profile_fingerprint,
    profile_payload,
)
from codesage_api.scoring.engine import score
from codesage_api.scoring.enums import Category, FindingStatus, Grade, Severity, Source
from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding, ScoringResult
from codesage_api.scoring.provenance import health_scoring_profile
from codesage_api.scoring.scope import contributes_to_health
from codesage_api.services import finding_triage, profiles
from codesage_api.services.finding_diff import diff_snapshots
from codesage_api.tasks import progress
from codesage_api.tasks.app import celery_app

#: Points on a project card's sparkline.
LATEST_HEALTH_TREND_POINTS = 7

@dataclass(frozen=True, slots=True)
class _ScoredSnapshot:
    snapshot: Snapshot
    result: ScoringResult
    file_facts: dict[str, FileFacts]
    findings_by_fingerprint: dict[str, Finding]
    profile: Profile


@dataclass(slots=True)
class _Tree:
    name: str
    path: str
    file_path: str | None = None
    children: dict[str, _Tree] = field(default_factory=dict)


def prepare_snapshot_score(
    session: Session,
    snapshot: Snapshot,
    profile: Profile,
) -> tuple[SnapshotScore, bool]:
    """Read score state or create a pending row without calculating it."""
    fingerprint = profile_fingerprint(profile)
    cached = session.scalar(
        select(SnapshotScore).where(
            SnapshotScore.snapshot_id == snapshot.id,
            SnapshotScore.profile_fingerprint == fingerprint,
            SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
        )
    )
    if cached is not None:
        if cached.status == "error":
            cached.status = "pending"
            cached.failure_information = None
            cached.started_at = None
            cached.completed_at = None
            return cached, True
        return cached, False
    cached = SnapshotScore(
        snapshot_id=snapshot.id,
        profile_fingerprint=fingerprint,
        scoring_engine_version=SCORING_ENGINE_VERSION,
        status="pending",
    )
    session.add(cached)
    session.flush()
    return cached, True


def calculate_snapshot_score(
    session: Session,
    workspace_id: uuid.UUID,
    cached: SnapshotScore,
    profile: Profile,
) -> None:
    """Hydrate facts and fill one prepared cache row."""
    hydrated = dashboard_repository.get_snapshot_for_scoring(
        session, workspace_id, cached.snapshot_id
    )
    if hydrated is None:
        raise NotFound
    scored = _score_snapshot(hydrated, profile)
    cached.health_score = scored.result.health_score
    cached.grade = scored.result.grade
    cached.debt_score = scored.result.total_debt
    cached.kloc = scored.result.health_kloc
    refs = dashboard_repository.list_completed_snapshot_refs(
        session,
        workspace_id,
        hydrated.analysis_attempt.branch.repository_id,
        hydrated.analysis_attempt.branch.name,
    )
    current_index = next((index for index, item in enumerate(refs) if item.id == hydrated.id), -1)
    previous = (
        dashboard_repository.get_snapshot_for_scoring(
            session, workspace_id, refs[current_index - 1].id
        )
        if current_index > 0
        else None
    )
    cached.result_payload = _result_payload(scored, previous)


def build_latest_health_hint(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    profile: Profile,
) -> tuple[LatestHealthOut | None, list[SnapshotScore]]:
    """The projects-list hint, and any score rows it had to create.

    Costs a fixed handful of small queries per project: the payload is never
    loaded, only its `red_issue_count` key is read, inside Postgres.
    """
    refs = dashboard_repository.list_latest_completed_snapshot_refs(
        session, workspace_id, repository_id, branch, limit=2
    )
    if not refs:
        return None, []
    pending: list[SnapshotScore] = []
    prepared: list[SnapshotScore] = []
    for ref in refs:
        cached, created = prepare_snapshot_score(session, ref, profile)
        prepared.append(cached)
        if created:
            pending.append(cached)
    latest = prepared[0]
    if latest.status != "ready" or latest.health_score is None or latest.grade is None:
        return None, pending
    previous = prepared[1] if len(prepared) > 1 else None
    delta = (
        latest.health_score - previous.health_score
        if previous is not None and previous.status == "ready" and previous.health_score is not None
        else 0.0
    )
    red_issue_count = session.scalar(
        select(SnapshotScore.result_payload["red_issue_count"].astext).where(
            SnapshotScore.id == latest.id
        )
    )
    # A plain read of ready rows: an older snapshot without a score is left
    # out of the sparkline, not queued.
    recent = dashboard_repository.list_recent_ready_scores(
        session,
        workspace_id,
        repository_id,
        branch,
        profile_fingerprint=profile_fingerprint(profile),
        scoring_engine_version=SCORING_ENGINE_VERSION,
        limit=LATEST_HEALTH_TREND_POINTS,
    )
    return (
        LatestHealthOut(
            score=latest.health_score,
            grade=Grade(latest.grade),
            delta=delta,
            kloc=latest.kloc,
            finding_count=refs[0].finding_count,
            red_issue_count=int(red_issue_count) if red_issue_count is not None else None,
            scanned_at=refs[0].scan_time.isoformat(),
            trend=[
                HealthPointOut(t=scan_time.isoformat(), score=score, commit_sha=commit_sha)
                for scan_time, commit_sha, score in reversed(recent)
            ],
        ),
        pending,
    )


def _metric_value(source_file: SourceFile, name: str) -> float:
    return next(
        (metric.value for metric in source_file.static_metrics if metric.metric_name == name),
        0.0,
    )


def _score_snapshot(snapshot: Snapshot, profile: Profile) -> _ScoredSnapshot:
    file_facts: dict[str, FileFacts] = {}
    scoring_findings: list[ScoringFinding] = []
    findings_by_fingerprint: dict[str, Finding] = {}
    collected: list[tuple[Finding, ScoringFinding]] = []

    for source_file in snapshot.source_files:
        file_risk = (
            source_file.bug_risk_predictions[0].risk_score
            if source_file.bug_risk_predictions
            else 0.0
        )
        class_risks = {
            prediction.class_name: prediction.risk_score
            for prediction in source_file.class_risk_predictions
        }
        file_facts[source_file.relative_path] = FileFacts(
            file=source_file.relative_path,
            risk_score=file_risk,
            commits_90d=(
                source_file.process_metric.commits_90d or 0
                if source_file.process_metric is not None
                else 0
            ),
            loc=int(_metric_value(source_file, "loc")),
            source_scope=source_file.source_scope or "unknown",
        )
        for location in source_file.source_locations:
            for stored in location.findings:
                finding_risk = (
                    class_risks.get(stored.class_name) if stored.class_name is not None else None
                )
                collected.append(
                    (
                        stored,
                        ScoringFinding(
                            fingerprint=stored.fingerprint,
                            source=Source(stored.source.value),
                            category=Category(stored.category_id),
                            severity=Severity(stored.severity.value),
                            file=source_file.relative_path,
                            risk_score=(finding_risk if finding_risk is not None else file_risk),
                        ),
                    )
                )

    unique = unique_in_file_order(
        [
            (stored.fingerprint, finding.file, stored.source_location.start_line)
            for stored, finding in collected
        ]
    )
    for (stored, finding), fingerprint in zip(collected, unique, strict=True):
        scoring_findings.append(replace(finding, fingerprint=fingerprint))
        findings_by_fingerprint[fingerprint] = stored

    result = score(
        scoring_findings,
        file_facts,
        profile,
    )
    return _ScoredSnapshot(snapshot, result, file_facts, findings_by_fingerprint, profile)


def _finding_outputs(scored: _ScoredSnapshot, previous: Snapshot | None = None) -> list[FindingOut]:
    output: list[FindingOut] = []
    trace = diff_snapshots(scored.snapshot, previous)
    for item in scored.result.findings:
        stored = scored.findings_by_fingerprint[item.finding.fingerprint]
        location = stored.source_location
        is_satd = item.finding.source is Source.SATD
        output.append(
            FindingOut(
                fingerprint=item.finding.fingerprint,
                source=item.finding.source,
                category=item.finding.category,
                severity=item.finding.severity,
                file=item.finding.file,
                source_scope=location.source_file.source_scope or "unknown",
                line=location.start_line,
                end_line=location.end_line,
                symbol=location.code_symbol.name if location.code_symbol else None,
                reason=stored.description,
                status=FindingStatus.OPEN,
                change_status=(
                    "unchanged" if item.finding.fingerprint in trace.unchanged else "new"
                ),
                priority=item.priority,
                pinned_by_floor=item.pinned_by_floor,
                rule_id=stored.rule_id,
                metric_value=stored.measured_value,
                threshold=stored.threshold,
                comment_text=stored.evidence if is_satd or stored.rule_id == "comment-pattern" else None,
                confidence=stored.confidence if is_satd else None,
            )
        )
    return output


def _tree(scored: _ScoredSnapshot) -> list[TreeNodeOut]:
    roots: dict[str, _Tree] = {}
    for file_path in scored.file_facts:
        parts = PurePosixPath(file_path).parts
        current = roots
        accumulated: list[str] = []
        for index, part in enumerate(parts):
            accumulated.append(part)
            node = current.setdefault(part, _Tree(part, "/".join(accumulated)))
            if index == len(parts) - 1:
                node.file_path = file_path
            current = node.children

    scored_files = {item.file: item for item in scored.result.files}

    def render(node: _Tree) -> tuple[TreeNodeOut, list[str]]:
        if node.file_path is not None:
            item = scored_files[node.file_path]
            return (
                TreeNodeOut(
                    path=node.path,
                    name=node.name,
                    type="file",
                    health_score=item.health_score,
                    grade=formula.grade(item.health_score),
                    debt_score=item.debt_score,
                    risk_score=item.risk_score,
                    children=None,
                ),
                [node.file_path],
            )

        rendered: list[TreeNodeOut] = []
        descendant_files: list[str] = []
        for child in sorted(node.children.values(), key=lambda value: value.name):
            child_out, child_files = render(child)
            rendered.append(child_out)
            descendant_files.extend(child_files)
        debt = sum(scored_files[path].debt_score for path in descendant_files)
        kloc = (
            sum(
                scored.file_facts[path].loc
                for path in descendant_files
                if contributes_to_health(
                    scored.file_facts[path].source_scope,
                    include_test_findings=scored.profile.include_test_findings,
                )
            )
            / 1000.0
        )
        health = formula.repo_health(debt, kloc)
        risk = max((scored_files[path].risk_score for path in descendant_files), default=0.0)
        return (
            TreeNodeOut(
                path=node.path,
                name=node.name,
                type="folder",
                health_score=health,
                grade=formula.grade(health),
                debt_score=debt,
                risk_score=risk,
                children=rendered,
            ),
            descendant_files,
        )

    return [render(node)[0] for node in sorted(roots.values(), key=lambda value: value.name)]


def _model_version(snapshot: Snapshot) -> str | None:
    versions = {
        prediction.model_version.version_identifier
        for source_file in snapshot.source_files
        for prediction in source_file.bug_risk_predictions
    }
    versions.update(
        stored.satd_prediction.model_version.version_identifier
        for source_file in snapshot.source_files
        for location in source_file.source_locations
        for stored in location.findings
        if stored.satd_prediction is not None
    )
    return ", ".join(sorted(versions)) or None


def _result_payload(scored: _ScoredSnapshot, previous: Snapshot | None = None) -> dict[str, object]:
    """Serialize every profile-dependent dashboard value in the worker."""
    findings = _finding_outputs(scored, previous)
    trace = diff_snapshots(scored.snapshot, previous)
    return {
        "health_score": scored.result.health_score,
        "grade": scored.result.grade,
        "red_issue_count": sum(
            item.severity in {Severity.CRITICAL, Severity.HIGH} for item in findings
        ),
        "model_version": _model_version(scored.snapshot),
        "findings": [item.model_dump(mode="json") for item in findings],
        "resolved_finding_count": len(trace.resolved),
        "tree": [item.model_dump(mode="json") for item in _tree(scored)],
        "file_scores": [
            FileScoreOut(
                file=item.file,
                debt_score=item.debt_score,
                risk_score=item.risk_score,
            ).model_dump(mode="json")
            for item in scored.result.files
        ],
        "category_breakdown": [
            CategoryBreakdownItemOut(
                category=item.category,
                count=item.count,
                debt=item.debt,
            ).model_dump(mode="json")
            for item in scored.result.breakdown
        ],
    }


def needs_enqueue(cached: SnapshotScore, created: bool) -> bool:
    """Queue a score calculation once: when it is new or not yet picked up, and
    only if no earlier request queued it in the last couple of minutes.

    A score still "running" well past the calculation's time limit was dropped
    by a worker that died; it is queued again rather than left pending forever.
    """
    waiting = created or (cached.status == "pending" and cached.started_at is None)
    return (waiting or _stalled(cached)) and progress.claim_score_enqueue(str(cached.id))


def _stalled(cached: SnapshotScore) -> bool:
    if cached.status != "running" or cached.started_at is None:
        return False
    started = cached.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    limit = timedelta(seconds=2 * get_settings().score_time_limit_seconds)
    return datetime.now(UTC) - started > limit


def _enqueue_pending_score(
    session: Session,
    workspace_id: uuid.UUID,
    snapshot: Snapshot,
    profile: Profile,
) -> None:
    cached, created = prepare_snapshot_score(session, snapshot, profile)
    if not needs_enqueue(cached, created):
        return
    session.commit()
    celery_app.send_task(
        "codesage.score_snapshot",
        args=[str(cached.id), str(workspace_id), profile_payload(profile)],
    )


def _enqueue_missing_scores(
    session: Session,
    workspace_id: uuid.UUID,
    snapshots: list[Snapshot],
    profile: Profile,
    ready_snapshot_ids: set[uuid.UUID],
) -> None:
    """Queue every missing score, newest snapshot first.

    `snapshots` arrive oldest first, the order the caller returns them in. The
    single scoring worker runs jobs in the order they were queued, so the newest
    snapshot — the one the dashboard shows — goes first instead of waiting
    behind every old one. Only the queue order changes, never the response.
    """
    jobs: list[str] = []
    for snapshot in reversed(snapshots):
        if snapshot.id in ready_snapshot_ids:
            continue
        cached, created = prepare_snapshot_score(session, snapshot, profile)
        if needs_enqueue(cached, created):
            jobs.append(str(cached.id))
    if not jobs:
        return
    session.commit()
    payload = profile_payload(profile)
    for cache_id in jobs:
        celery_app.send_task(
            "codesage.score_snapshot",
            args=[cache_id, str(workspace_id), payload],
        )


def build_findings_page(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None,
    *,
    limit: int,
    offset: int,
    source: str | None = None,
    severity: str | None = None,
    category: str | None = None,
    status: str | None = None,
) -> FindingPageOut:
    """Read one ranked page without transferring the full cached JSON document."""
    return prepare_findings_page(
        session,
        workspace_id,
        repository_id,
        branch,
        snapshot_id,
        limit=limit,
        offset=offset,
        source=source,
        severity=severity,
        category=category,
        status=status,
    ).build()


def prepare_findings_page(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None,
    *,
    limit: int,
    offset: int,
    source: str | None = None,
    severity: str | None = None,
    category: str | None = None,
    status: str | None = None,
) -> PreparedRead[FindingPageOut]:
    profile = profiles.resolve_effective(session, workspace_id, repository_id)
    refs = dashboard_repository.list_completed_snapshot_refs(
        session, workspace_id, repository_id, branch
    )
    if not refs:
        raise NotFound
    selected: Snapshot | None = refs[-1]
    if snapshot_id is not None:
        selected = next((item for item in refs if item.id == snapshot_id), None)
    if selected is None:
        raise NotFound
    ready = session.execute(
        select(SnapshotScore.id, SnapshotScore.completed_at).where(
            SnapshotScore.snapshot_id == selected.id,
            SnapshotScore.profile_fingerprint == profile_fingerprint(profile),
            SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
            SnapshotScore.status == "ready",
        )
    ).first()
    if ready is None:
        _enqueue_pending_score(session, workspace_id, selected, profile)
        raise ScorePending
    cache_id, completed_at = ready
    selected_id = selected.id

    def version() -> tuple[object, ...]:
        return (
            "findings",
            workspace_id,
            repository_id,
            branch,
            cache_id,
            completed_at,
            limit,
            offset,
            source,
            severity,
            category,
            status,
            finding_triage.version_for_snapshot(session, selected_id),
        )

    def build() -> FindingPageOut:
        return _finish_findings_page(
            session,
            cache_id,
            selected_id,
            limit=limit,
            offset=offset,
            source=source,
            severity=severity,
            category=category,
            status=status,
        )

    return PreparedRead(version=version, build=build)


def _finish_findings_page(
    session: Session,
    cache_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
    source: str | None,
    severity: str | None,
    category: str | None,
    status: str | None,
) -> FindingPageOut:

    clauses = []
    params: dict[str, object] = {
        "cache": cache_id,
        "snapshot": snapshot_id,
        "limit": limit,
        "offset": offset,
    }
    for key, value in (("source", source), ("severity", severity), ("category", category)):
        if value is not None:
            clauses.append(f"item->>\x27{key}\x27 = :{key}")
            params[key] = value
    if status is not None:
        clauses.append("actual_status = :status")
        params["status"] = status
    where = " AND ".join(clauses) or "true"
    base = f"""
        FROM snapshot_score ss
        CROSS JOIN LATERAL jsonb_array_elements(ss.result_payload->\x27findings\x27)
            WITH ORDINALITY AS ranked(item, ordinal)
        LEFT JOIN finding_triage ft ON ft.snapshot_id = :snapshot
            AND ft.fingerprint = ranked.item->>\x27fingerprint\x27
        CROSS JOIN LATERAL (SELECT coalesce(ft.status, ranked.item->>\x27status\x27) AS actual_status) state
        WHERE ss.id = :cache AND {where}
    """
    total = int(session.scalar(text("SELECT count(*) " + base), params) or 0)
    rows = session.scalars(
        text(
            "SELECT item || jsonb_build_object(\x27status\x27, actual_status) "
            + base
            + " ORDER BY ordinal LIMIT :limit OFFSET :offset"
        ),
        params,
    ).all()
    return FindingPageOut(
        items=[FindingOut.model_validate(item) for item in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@dataclass(frozen=True, slots=True)
class PreparedRead[T]:
    """The cheap, checked half of a dashboard read, and how to finish it.

    `version()` names everything that decides the response's bytes, for its
    ETag; `build()` does the expensive part. Callers that need no ETag never
    pay for one.
    """

    version: Callable[[], tuple[object, ...]]
    build: Callable[[], T]


def build_health_report(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None = None,
    *,
    include_findings: bool = True,
) -> HealthReportOut:
    return prepare_health_report(
        session,
        workspace_id,
        repository_id,
        branch,
        snapshot_id,
        include_findings=include_findings,
    ).build()


def prepare_health_report(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None = None,
    *,
    include_findings: bool = True,
) -> PreparedRead[HealthReportOut]:
    profile = profiles.resolve_effective(session, workspace_id, repository_id)
    refs = dashboard_repository.list_completed_snapshot_refs(
        session, workspace_id, repository_id, branch
    )
    if not refs:
        raise NotFound
    selected_index = len(refs) - 1
    if snapshot_id is not None:
        selected_index = next(
            (index for index, item in enumerate(refs) if item.id == snapshot_id), -1
        )
        if selected_index < 0:
            raise NotFound
    fingerprint = profile_fingerprint(profile)
    # The payload is deferred: history rows bring only their scores.
    cached_rows = session.scalars(
        select(SnapshotScore).where(
            SnapshotScore.snapshot_id.in_([item.id for item in refs]),
            SnapshotScore.profile_fingerprint == fingerprint,
            SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
        )
    ).all()
    cached_by_snapshot = {item.snapshot_id: item for item in cached_rows}
    selected_ref = refs[selected_index]
    selected_cache = cached_by_snapshot.get(selected_ref.id)
    if selected_cache is None or selected_cache.status != "ready":
        _enqueue_pending_score(session, workspace_id, selected_ref, profile)
        raise ScorePending

    def version() -> tuple[object, ...]:
        return (
            "health",
            workspace_id,
            repository_id,
            branch,
            include_findings,
            selected_cache.id,
            selected_cache.completed_at,
            profile.name,
            profile.include_test_findings,
            tuple(
                (ref.id, cached_by_snapshot[ref.id].health_score)
                for ref in refs
                if ref.id in cached_by_snapshot
            ),
            finding_triage.version_for_snapshot(session, selected_ref.id),
        )

    def build() -> HealthReportOut:
        return _finish_health_report(
            session,
            repository_id,
            branch,
            refs,
            selected_index,
            selected_cache,
            cached_by_snapshot,
            profile,
            include_findings=include_findings,
        )

    return PreparedRead(version=version, build=build)


def _finish_health_report(
    session: Session,
    repository_id: uuid.UUID,
    branch: str,
    refs: list[Snapshot],
    selected_index: int,
    selected_cache: SnapshotScore,
    cached_by_snapshot: dict[uuid.UUID, SnapshotScore],
    profile: Profile,
    *,
    include_findings: bool,
) -> HealthReportOut:
    selected_ref = refs[selected_index]
    # One payload, the selected snapshot's, without its findings unless asked.
    payload_column = (
        SnapshotScore.result_payload
        if include_findings
        else SnapshotScore.result_payload.op("-")("findings")
    )
    payload = session.scalar(
        select(payload_column).where(SnapshotScore.id == selected_cache.id)
    )
    if payload is None:
        raise ScorePending
    previous = cached_by_snapshot.get(refs[selected_index - 1].id) if selected_index > 0 else None
    previous_score = previous.health_score if previous is not None else None
    health_score = float(payload["health_score"])
    delta = health_score - previous_score if previous_score is not None else 0.0
    statuses = finding_triage.statuses_for_snapshot(session, selected_ref.id)

    return HealthReportOut(
        snapshot_id=str(selected_ref.id),
        repo_id=str(repository_id),
        branch=branch,
        commit_sha=selected_ref.commit_sha,
        scanned_at=selected_ref.scan_time.isoformat(),
        health_score=health_score,
        grade=Grade(str(payload["grade"])),
        delta=delta,
        red_issue_count=int(payload["red_issue_count"]),
        resolved_finding_count=int(payload.get("resolved_finding_count", 0)),
        profile=profile.name,
        include_test_findings=profile.include_test_findings,
        model_version=(
            str(payload["model_version"]) if payload.get("model_version") is not None else None
        ),
        history=[
            HealthPointOut(
                t=ref.scan_time.isoformat(),
                score=(
                    health_score
                    if ref.id == selected_ref.id
                    else cached_by_snapshot[ref.id].health_score
                ),
                commit_sha=ref.commit_sha,
            )
            for ref in refs
            if ref.id == selected_ref.id
            or (
                ref.id in cached_by_snapshot and cached_by_snapshot[ref.id].health_score is not None
            )
        ],
        tree=[TreeNodeOut.model_validate(item) for item in payload["tree"]],
        file_scores=[FileScoreOut.model_validate(item) for item in payload["file_scores"]],
        findings=[
            FindingOut.model_validate(
                {**item, "status": statuses.get(str(item["fingerprint"]), item["status"])}
            )
            for item in payload.get("findings", [])
        ],
        category_breakdown=[
            CategoryBreakdownItemOut.model_validate(item) for item in payload["category_breakdown"]
        ],
        finding_summary=_finding_summary(
            session,
            selected_cache.id,
            selected_ref.id,
            include_test_findings=profile.include_test_findings,
        ),
        kloc=selected_cache.kloc,
        # The worker writes one file score per analysed file, in every scope.
        java_file_count=len(payload["file_scores"]),
    )


def _finding_summary(
    session: Session,
    cache_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    *,
    include_test_findings: bool,
) -> FindingSummaryOut:
    """Count the Refactor-First list's default view in one aggregate.

    Postgres expands the findings array itself, so this works whether or not
    the report carries its findings, and none of them travel to Python. Every
    input (the payload, triage and the profile's test switch) is already in the
    health report's ETag.
    """
    row = session.execute(
        text(
            """
            SELECT
                count(*) AS total,
                count(*) FILTER (WHERE actual_status <> 'done') AS open,
                count(*) FILTER (WHERE actual_status = 'done') AS done,
                count(*) FILTER (WHERE actual_status <> 'done'
                    AND item->>'severity' = 'critical') AS critical,
                count(*) FILTER (WHERE actual_status <> 'done'
                    AND item->>'severity' = 'high') AS high,
                count(*) FILTER (WHERE actual_status <> 'done'
                    AND item->>'severity' = 'medium') AS medium,
                count(*) FILTER (WHERE actual_status <> 'done'
                    AND item->>'severity' = 'low') AS low
            FROM snapshot_score ss
            CROSS JOIN LATERAL jsonb_array_elements(ss.result_payload->'findings') AS listed(item)
            LEFT JOIN finding_triage ft ON ft.snapshot_id = :snapshot
                AND ft.fingerprint = listed.item->>'fingerprint'
            CROSS JOIN LATERAL (
                SELECT coalesce(ft.status, listed.item->>'status') AS actual_status
            ) state
            WHERE ss.id = :cache
                AND (:include_test OR coalesce(listed.item->>'source_scope', '') <> 'test')
            """
        ),
        {"cache": cache_id, "snapshot": snapshot_id, "include_test": include_test_findings},
    ).one()
    return FindingSummaryOut(
        total=int(row.total),
        open=int(row.open),
        done=int(row.done),
        open_by_severity=SeverityCountsOut(
            critical=int(row.critical),
            high=int(row.high),
            medium=int(row.medium),
            low=int(row.low),
        ),
    )


def build_calibration_export(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None = None,
) -> CalibrationRecordOut:
    """Export the same finalized D and L used by the production health score."""
    report = build_health_report(session, workspace_id, repository_id, branch, snapshot_id)
    profile = profiles.resolve_effective(session, workspace_id, repository_id)
    cached = session.scalar(
        select(SnapshotScore).where(
            SnapshotScore.snapshot_id == uuid.UUID(report.snapshot_id),
            SnapshotScore.profile_fingerprint == profile_fingerprint(profile),
            SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
            SnapshotScore.status == "ready",
        )
    )
    if cached is None or cached.debt_score is None or cached.kloc is None:
        raise ScorePending
    snapshot = dashboard_repository.find_done_snapshot(
        session, workspace_id, uuid.UUID(report.snapshot_id)
    )
    if snapshot is None:
        raise NotFound
    engine = snapshot.analysis_attempt.analysis_engine_version
    counts = {
        "severity": dict(Counter(item.severity.value for item in report.findings)),
        "category": dict(Counter(item.category.value for item in report.findings)),
        "source": dict(Counter(item.source.value for item in report.findings)),
    }
    provenance = health_scoring_profile(
        profile,
        analysis_engine={
            "version_identifier": engine.version_identifier,
            "tool_versions": engine.tool_versions,
            "rule_set_version": engine.rule_set_version,
            "extraction_logic_version": engine.extraction_logic_version,
        },
        model_versions={"snapshot_models": report.model_version},
    )
    provenance.update(
        {
            "snapshot_id": report.snapshot_id,
            "scanned_at": report.scanned_at,
            "branch": report.branch,
        }
    )
    return CalibrationRecordOut(
        repository_id=str(repository_id),
        commit_sha=report.commit_sha,
        debt_score=cached.debt_score,
        kloc=cached.kloc,
        counts=CalibrationCountsOut(
            severity=counts["severity"],
            category=counts["category"],
            source=counts["source"],
        ),
        provenance=provenance,
    )


def build_trend(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
) -> list[dict[str, object]]:
    profile = profiles.resolve_effective(session, workspace_id, repository_id)
    refs = dashboard_repository.list_completed_snapshot_refs(
        session, workspace_id, repository_id, branch
    )
    fingerprint = profile_fingerprint(profile)
    cached = {
        item.snapshot_id: item
        for item in session.scalars(
            select(SnapshotScore).where(
                SnapshotScore.snapshot_id.in_([item.id for item in refs]),
                SnapshotScore.profile_fingerprint == fingerprint,
                SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
                SnapshotScore.status == "ready",
            )
        ).all()
    }
    _enqueue_missing_scores(session, workspace_id, refs, profile, set(cached))
    return [
        {
            "t": item.scan_time.isoformat(),
            "score": cached[item.id].health_score,
            "commit_sha": item.commit_sha,
        }
        for item in refs
        if item.id in cached and cached[item.id].health_score is not None
    ]


def build_scan_history(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str | None,
) -> list[ScanSummaryOut]:
    profile = profiles.resolve_effective(session, workspace_id, repository_id)
    refs = dashboard_repository.list_completed_snapshot_refs(
        session, workspace_id, repository_id, branch
    )
    if not refs:
        return []
    fingerprint = profile_fingerprint(profile)
    cached = {
        item.snapshot_id: item
        for item in session.scalars(
            select(SnapshotScore).where(
                SnapshotScore.snapshot_id.in_([item.id for item in refs]),
                SnapshotScore.profile_fingerprint == fingerprint,
                SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
                SnapshotScore.status == "ready",
            )
        ).all()
    }
    _enqueue_missing_scores(session, workspace_id, refs, profile, set(cached))
    output: list[ScanSummaryOut] = []
    previous_by_branch: dict[str, float] = {}
    for item in refs:
        stored_score = cached.get(item.id)
        if stored_score is None or stored_score.health_score is None:
            continue
        current = stored_score.health_score
        item_branch = item.analysis_attempt.branch.name
        previous = previous_by_branch.get(item_branch)
        output.append(
            ScanSummaryOut(
                snapshot_id=str(item.id),
                scan_id=str(item.analysis_attempt_id),
                branch=item_branch,
                commit_sha=item.commit_sha,
                scanned_at=item.scan_time.isoformat(),
                finding_count=item.finding_count,
                health_score=current,
                grade=Grade(str(stored_score.grade)),
                delta=current - previous if previous is not None else 0.0,
            )
        )
        previous_by_branch[item_branch] = current
    return list(reversed(output))
