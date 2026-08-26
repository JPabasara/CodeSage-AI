"""Assemble stored snapshot facts into profile-dependent read models."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import Finding, Snapshot, SnapshotScore, SourceFile
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.errors import NotFound
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
from codesage_api.scoring.cache import SCORING_ENGINE_VERSION, profile_fingerprint
from codesage_api.scoring.engine import score
from codesage_api.scoring.enums import Category, FindingStatus, Grade, Severity, Source
from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding, ScoringResult
from codesage_api.services import profiles


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


def _load_scored(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
) -> tuple[Profile, list[_ScoredSnapshot]]:
    stored = dashboard_repository.list_completed_snapshots(
        session, workspace_id, repository_id, branch
    )
    if not stored:
        raise NotFound
    profile = profiles.get_active(session, workspace_id)
    return profile, [_score_snapshot(snapshot, profile) for snapshot in stored]


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
    hydrated = dashboard_repository.get_snapshot_for_scoring(
        session, workspace_id, refs[selected_index].id
    )
    if hydrated is None:
        raise NotFound
    current = _score_snapshot(hydrated, profile)

    fingerprint = profile_fingerprint(profile)
    cached_rows = session.scalars(
        select(SnapshotScore).where(
            SnapshotScore.snapshot_id.in_([item.id for item in refs]),
            SnapshotScore.profile_fingerprint == fingerprint,
            SnapshotScore.scoring_engine_version == SCORING_ENGINE_VERSION,
            SnapshotScore.status == "ready",
        )
    ).all()
    cached_by_snapshot = {item.snapshot_id: item for item in cached_rows}
    previous = (
        cached_by_snapshot.get(refs[selected_index - 1].id)
        if selected_index > 0
        else None
    )
    previous_score = previous.health_score if previous is not None else None
    delta = current.result.health_score - previous_score if previous_score is not None else 0.0
    findings = _finding_outputs(current)

    return HealthReportOut(
        snapshot_id=str(current.snapshot.id),
        repo_id=str(repository_id),
        branch=branch,
        commit_sha=current.snapshot.commit_sha,
        scanned_at=current.snapshot.scan_time.isoformat(),
        health_score=current.result.health_score,
        grade=Grade(current.result.grade),
        delta=delta,
        red_issue_count=sum(
            item.severity in {Severity.CRITICAL, Severity.HIGH} for item in findings
        ),
        profile=profile.name,
        model_version=_model_version(current.snapshot),
        history=[
            HealthPointOut(
                t=ref.scan_time.isoformat(),
                score=(
                    current.result.health_score
                    if ref.id == current.snapshot.id
                    else cached_by_snapshot[ref.id].health_score
                ),
                commit_sha=ref.commit_sha,
            )
            for ref in refs
            if ref.id == current.snapshot.id
            or (
                ref.id in cached_by_snapshot
                and cached_by_snapshot[ref.id].health_score is not None
            )
        ],
        tree=_tree(current),
        file_scores=[
            FileScoreOut(
                file=item.file,
                debt_score=item.debt_score,
                risk_score=item.risk_score,
            )
            for item in current.result.files
        ],
        findings=findings,
        category_breakdown=[
            CategoryBreakdownItemOut(
                category=item.category,
                count=item.count,
                debt=item.debt,
            )
            for item in current.result.breakdown
        ],
    )


def build_trend(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
) -> list[dict[str, object]]:
    _profile, snapshots = _load_scored(session, workspace_id, repository_id, branch)
    return [
        {
            "t": item.snapshot.scan_time.isoformat(),
            "score": item.result.health_score,
            "commit_sha": item.snapshot.commit_sha,
        }
        for item in snapshots
    ]


def build_scan_history(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    branch: str,
) -> list[ScanSummaryOut]:
    _profile, snapshots = _load_scored(session, workspace_id, repository_id, branch)
    output: list[ScanSummaryOut] = []
    previous: float | None = None
    for item in snapshots:
        current = item.result.health_score
        output.append(
            ScanSummaryOut(
                snapshot_id=str(item.snapshot.id),
                scan_id=str(item.snapshot.analysis_attempt_id),
                branch=item.snapshot.analysis_attempt.branch.name,
                commit_sha=item.snapshot.commit_sha,
                scanned_at=item.snapshot.scan_time.isoformat(),
                finding_count=item.snapshot.finding_count,
                health_score=current,
                grade=Grade(item.result.grade),
                delta=current - previous if previous is not None else 0.0,
            )
        )
        previous = current
    return list(reversed(output))
