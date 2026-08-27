"""Assemble stored snapshot facts into profile-dependent read models."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import Finding, Snapshot, SnapshotScore, SourceFile
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.errors import NotFound, ScorePending
from codesage_api.schemas import (
    CategoryBreakdownItemOut,
    FileScoreOut,
    FindingOut,
    HealthPointOut,
    HealthReportOut,
    ScanSummaryOut,
    TreeNodeOut,
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
from codesage_api.services import profiles
from codesage_api.tasks.app import celery_app


@dataclass(frozen=True, slots=True)
class _ScoredSnapshot:
    snapshot: Snapshot
    result: ScoringResult
    file_facts: dict[str, FileFacts]
    findings_by_fingerprint: dict[str, Finding]


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
    cached.debt_score = sum(item.debt_score for item in scored.result.files)
    cached.kloc = sum(item.loc for item in scored.file_facts.values()) / 1000.0
    cached.result_payload = _result_payload(scored)


def build_latest_health_hint(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    profile: Profile,
) -> tuple[tuple[SnapshotScore, float] | None, list[SnapshotScore]]:
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
    if latest.status != "ready" or latest.health_score is None:
        return None, pending
    previous = prepared[1] if len(prepared) > 1 else None
    delta = (
        latest.health_score - previous.health_score
        if previous is not None
        and previous.status == "ready"
        and previous.health_score is not None
        else 0.0
    )
    return (latest, delta), pending


def _metric_value(source_file: SourceFile, name: str) -> float:
    return next(
        (metric.value for metric in source_file.static_metrics if metric.metric_name == name),
        0.0,
    )


def _score_snapshot(snapshot: Snapshot, profile: Profile) -> _ScoredSnapshot:
    file_facts: dict[str, FileFacts] = {}
    scoring_findings: list[ScoringFinding] = []
    findings_by_fingerprint: dict[str, Finding] = {}

    for source_file in snapshot.source_files:
        risk_score = (
            source_file.bug_risk_predictions[0].risk_score
            if source_file.bug_risk_predictions
            else 0.0
        )
        process = source_file.process_metric
        file_facts[source_file.relative_path] = FileFacts(
            file=source_file.relative_path,
            risk_score=risk_score,
            commits_90d=int(process.commits_90d) if process is not None else 0,
            loc=int(_metric_value(source_file, "loc")),
        )
        for location in source_file.source_locations:
            for stored in location.findings:
                scoring_findings.append(
                    ScoringFinding(
                        fingerprint=stored.fingerprint,
                        source=Source(stored.source.value),
                        category=Category(stored.category_id),
                        severity=Severity(stored.severity.value),
                        file=source_file.relative_path,
                    )
                )
                findings_by_fingerprint.setdefault(stored.fingerprint, stored)

    result = score(
        scoring_findings,
        file_facts,
        profile,
        kloc=sum(item.loc for item in file_facts.values()) / 1000.0,
    )
    return _ScoredSnapshot(snapshot, result, file_facts, findings_by_fingerprint)


def _finding_outputs(scored: _ScoredSnapshot) -> list[FindingOut]:
    output: list[FindingOut] = []
    for item in scored.result.findings:
        stored = scored.findings_by_fingerprint[item.finding.fingerprint]
        location = stored.source_location
        is_satd = item.finding.source is Source.SATD
        output.append(
            FindingOut(
                fingerprint=stored.fingerprint,
                source=item.finding.source,
                category=item.finding.category,
                severity=item.finding.severity,
                file=item.finding.file,
                line=location.start_line,
                symbol=location.code_symbol.name if location.code_symbol else None,
                reason=stored.description,
                status=FindingStatus.OPEN,
                priority=item.priority,
                pinned_by_floor=item.pinned_by_floor,
                rule_id=stored.rule_id,
                metric_value=stored.measured_value,
                threshold=stored.threshold,
                comment_text=stored.evidence if is_satd else None,
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
        kloc = sum(scored.file_facts[path].loc for path in descendant_files) / 1000.0
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


def _result_payload(scored: _ScoredSnapshot) -> dict[str, object]:
    """Serialize every profile-dependent dashboard value in the worker."""
    findings = _finding_outputs(scored)
    return {
        "health_score": scored.result.health_score,
        "grade": scored.result.grade,
        "red_issue_count": sum(
            item.severity in {Severity.CRITICAL, Severity.HIGH} for item in findings
        ),
        "model_version": _model_version(scored.snapshot),
        "findings": [item.model_dump(mode="json") for item in findings],
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


def _enqueue_pending_score(
    session: Session,
    workspace_id: uuid.UUID,
    snapshot: Snapshot,
    profile: Profile,
) -> None:
    cached, created = prepare_snapshot_score(session, snapshot, profile)
    should_enqueue = created or (
        cached.status == "pending" and cached.started_at is None
    )
    if not should_enqueue:
        return
    # The worker must not race an uncommitted cache row. SET LOCAL is restored by
    # the next request/worker session, and this read path performs no later query.
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
    jobs: list[str] = []
    for snapshot in snapshots:
        if snapshot.id in ready_snapshot_ids:
            continue
        cached, created = prepare_snapshot_score(session, snapshot, profile)
        if created or (cached.status == "pending" and cached.started_at is None):
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


def build_health_report(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
    snapshot_id: uuid.UUID | None = None,
) -> HealthReportOut:
    profile = profiles.get_active(session, workspace_id)
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
    if (
        selected_cache is None
        or selected_cache.status != "ready"
        or selected_cache.result_payload is None
    ):
        _enqueue_pending_score(session, workspace_id, selected_ref, profile)
        raise ScorePending

    payload = selected_cache.result_payload
    previous = (
        cached_by_snapshot.get(refs[selected_index - 1].id)
        if selected_index > 0
        else None
    )
    previous_score = previous.health_score if previous is not None else None
    health_score = float(payload["health_score"])
    delta = health_score - previous_score if previous_score is not None else 0.0

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
        profile=profile.name,
        model_version=(
            str(payload["model_version"])
            if payload.get("model_version") is not None
            else None
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
                ref.id in cached_by_snapshot
                and cached_by_snapshot[ref.id].health_score is not None
            )
        ],
        tree=[TreeNodeOut.model_validate(item) for item in payload["tree"]],
        file_scores=[FileScoreOut.model_validate(item) for item in payload["file_scores"]],
        findings=[FindingOut.model_validate(item) for item in payload["findings"]],
        category_breakdown=[
            CategoryBreakdownItemOut.model_validate(item)
            for item in payload["category_breakdown"]
        ],
    )


def build_trend(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
) -> list[dict[str, object]]:
    profile = profiles.get_active(session, workspace_id)
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
    branch: str,
) -> list[ScanSummaryOut]:
    profile = profiles.get_active(session, workspace_id)
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
    previous: float | None = None
    for item in refs:
        stored_score = cached.get(item.id)
        if stored_score is None or stored_score.health_score is None:
            continue
        current = stored_score.health_score
        output.append(
            ScanSummaryOut(
                snapshot_id=str(item.id),
                scan_id=str(item.analysis_attempt_id),
                branch=branch,
                commit_sha=item.commit_sha,
                scanned_at=item.scan_time.isoformat(),
                finding_count=item.finding_count,
                health_score=current,
                grade=Grade(str(stored_score.grade)),
                delta=current - previous if previous is not None else 0.0,
            )
        )
        previous = current
    return list(reversed(output))
