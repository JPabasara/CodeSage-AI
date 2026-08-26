from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    AnalysisStatus,
    AnalysisTriggerType,
    FindingSource,
)
from codesage_api.db.enums import (
    Severity as DbSeverity,
)
from codesage_api.db.models import (
    AnalysisAttempt,
    Branch,
    Finding,
    ProcessMetric,
    Snapshot,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.errors import NotFound
from codesage_api.scoring.enums import Category, Grade
from codesage_api.scoring.models import Profile
from codesage_api.services import dashboard


def test_snapshot_score_cache_hit_does_not_hydrate_snapshot(monkeypatch) -> None:
    snapshot = SimpleNamespace(id=uuid.uuid4())
    cached = SimpleNamespace(health_score=81.0, grade="B", status="ready")
    session = MagicMock(spec=Session)
    session.scalar.return_value = cached
    hydrate = MagicMock(side_effect=AssertionError("cache hit hydrated snapshot"))
    monkeypatch.setattr(
        dashboard.dashboard_repository,
        "get_snapshot_for_scoring",
        hydrate,
    )
    profile = Profile(weights={category: 1.0 for category in Category}, s=0.5)

    result, created = dashboard.prepare_snapshot_score(session, snapshot, profile)

    assert result is cached
    assert created is False
    hydrate.assert_not_called()


def _profile() -> Profile:
    return Profile(weights={category: 1.0 for category in Category}, s=0.5, name="Balanced")


def _snapshot(
    *,
    scanned_at: datetime,
    commit_sha: str,
    with_finding: bool,
) -> Snapshot:
    attempt_id = uuid.uuid4()
    branch = Branch(
        id=uuid.uuid4(),
        repository_id=uuid.uuid4(),
        name="main",
        head_commit_sha=commit_sha,
        is_default=True,
    )
    attempt = AnalysisAttempt(
        id=attempt_id,
        branch_id=branch.id,
        analysis_engine_version_id=uuid.uuid4(),
        commit_sha=commit_sha,
        trigger_type=AnalysisTriggerType.MANUAL,
        status=AnalysisStatus.DONE,
        start_time=scanned_at,
        completion_time=scanned_at,
        retry_count=0,
    )
    attempt.branch = branch
    snapshot = Snapshot(
        id=uuid.uuid4(),
        analysis_attempt_id=attempt_id,
        commit_sha=commit_sha,
        scan_time=scanned_at,
        finding_count=1 if with_finding else 0,
    )
    snapshot.analysis_attempt = attempt
    source_file = SourceFile(
        id=uuid.uuid4(),
        snapshot_id=snapshot.id,
        relative_path="src/A.java",
        language="java",
    )
    source_file.static_metrics = [
        StaticMetric(
            id=uuid.uuid4(),
            source_file_id=source_file.id,
            code_symbol_id=None,
            metric_name="loc",
            value=1000,
        )
    ]
    source_file.process_metric = ProcessMetric(
        id=uuid.uuid4(),
        source_file_id=source_file.id,
        commits_90d=0,
        author_count=1,
        file_age=10,
        recency=1,
    )
    source_file.bug_risk_predictions = []
    source_file.source_locations = []
    if with_finding:
        location = SourceLocation(
            id=uuid.uuid4(),
            source_file_id=source_file.id,
            code_symbol_id=None,
            start_line=7,
            end_line=7,
            start_column=0,
            end_column=0,
        )
        finding = Finding(
            id=uuid.uuid4(),
            source_location_id=location.id,
            category_id="security",
            rule_id="hardcoded-secret",
            satd_prediction_id=None,
            source=FindingSource.RULE,
            severity=DbSeverity.CRITICAL,
            description="Move the credential to an environment variable.",
            evidence=None,
            measured_value=None,
            threshold=None,
            confidence=None,
            fingerprint="critical-secret",
        )
        finding.source_location = location
        location.findings = [finding]
        location.code_symbol = None
        source_file.source_locations = [location]
    snapshot.source_files = [source_file]
    return snapshot


@patch("codesage_api.services.dashboard.profiles.get_active", return_value=_profile())
@patch("codesage_api.services.dashboard.dashboard_repository.get_snapshot_for_scoring")
@patch("codesage_api.services.dashboard.dashboard_repository.list_completed_snapshot_refs")
def test_health_report_scores_latest_snapshot_and_builds_history(
    list_snapshots: Mock,
    get_snapshot: Mock,
    _active_profile: Mock,
) -> None:
    now = datetime(2026, 8, 25, tzinfo=UTC)
    previous = _snapshot(
        scanned_at=now - timedelta(days=1), commit_sha="a" * 40, with_finding=False
    )
    current = _snapshot(scanned_at=now, commit_sha="b" * 40, with_finding=True)
    list_snapshots.return_value = [previous, current]
    get_snapshot.return_value = current
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = [
        SimpleNamespace(snapshot_id=previous.id, health_score=100.0)
    ]

    report = dashboard.build_health_report(
        session, uuid.uuid4(), uuid.uuid4(), "main"
    )

    assert report.snapshot_id == str(current.id)
    assert report.health_score == 68.0
    assert report.grade is Grade.C
    assert report.delta == -32.0
    assert report.red_issue_count == 1
    assert len(report.history) == 2
    assert report.findings[0].line == 7
    assert report.findings[0].pinned_by_floor is True
    assert report.tree[0].path == "src"
    assert report.tree[0].children is not None


@patch("codesage_api.services.dashboard.profiles.get_active", return_value=_profile())
@patch("codesage_api.services.dashboard.dashboard_repository.get_snapshot_for_scoring")
@patch("codesage_api.services.dashboard.dashboard_repository.list_completed_snapshot_refs")
def test_health_can_select_a_past_snapshot(
    list_snapshots: Mock,
    get_snapshot: Mock,
    _active_profile: Mock,
) -> None:
    now = datetime(2026, 8, 25, tzinfo=UTC)
    previous = _snapshot(scanned_at=now, commit_sha="a" * 40, with_finding=False)
    current = _snapshot(
        scanned_at=now + timedelta(days=1), commit_sha="b" * 40, with_finding=True
    )
    list_snapshots.return_value = [previous, current]
    get_snapshot.return_value = previous
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = []

    report = dashboard.build_health_report(
        session, uuid.uuid4(), uuid.uuid4(), "main", previous.id
    )

    assert report.snapshot_id == str(previous.id)
    assert report.health_score == 100.0
    assert report.delta == 0.0


@patch("codesage_api.services.dashboard.profiles.get_active", return_value=_profile())
@patch("codesage_api.services.dashboard.dashboard_repository.list_completed_snapshot_refs")
def test_no_completed_snapshot_is_not_found(
    list_snapshots: Mock, _active_profile: Mock
) -> None:
    list_snapshots.return_value = []

    with pytest.raises(NotFound):
        dashboard.build_health_report(
            Mock(), uuid.uuid4(), uuid.uuid4(), "main"
        )


@patch("codesage_api.services.dashboard.profiles.get_active", return_value=_profile())
@patch("codesage_api.services.dashboard.dashboard_repository.list_completed_snapshots")
def test_scan_history_is_newest_first_and_uses_current_profile(
    list_snapshots: Mock,
    _active_profile: Mock,
) -> None:
    now = datetime(2026, 8, 25, tzinfo=UTC)
    previous = _snapshot(scanned_at=now, commit_sha="a" * 40, with_finding=False)
    current = _snapshot(
        scanned_at=now + timedelta(days=1), commit_sha="b" * 40, with_finding=True
    )
    list_snapshots.return_value = [previous, current]

    history = dashboard.build_scan_history(
        Mock(), uuid.uuid4(), uuid.uuid4(), "main"
    )

    assert [item.snapshot_id for item in history] == [str(current.id), str(previous.id)]
    assert history[0].delta == -32.0
    assert history[1].delta == 0.0
