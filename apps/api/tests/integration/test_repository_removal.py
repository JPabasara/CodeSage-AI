"""PostgreSQL guarantees behind repository removal."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import UTC, datetime
from threading import Event

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    AnalysisStatus,
    AnalysisTriggerType,
    CodeSymbolType,
    FileTreeNodeType,
    FindingSource,
    MLModelType,
    ModelDeploymentStatus,
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
    Severity,
)
from codesage_api.db.models import (
    AnalysisAttempt,
    AnalysisEngineVersion,
    Branch,
    BugRiskPrediction,
    CodeSymbol,
    FileTreeNode,
    Finding,
    MLModelVersion,
    ProcessMetric,
    Repository,
    SATDPrediction,
    SecurityAuditRecord,
    Snapshot,
    SnapshotScore,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import NotFound, RepositoryScanRunning
from codesage_api.integrations.github import GitHubBranch
from codesage_api.services import analysis, repositories

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414


def _repository(workspace_id: uuid.UUID) -> tuple[Repository, Branch]:
    repository = Repository(
        workspace_id=workspace_id,
        source_platform=RepositoryPlatform.GITHUB,
        external_repository_id=str(uuid.uuid4()),
        name="removal-test",
        owner="acme",
        url="https://github.com/acme/removal-test",
        visibility=RepositoryVisibility.PUBLIC,
        connection_status=RepositoryConnectionStatus.CONNECTED,
    )
    branch = Branch(
        repository=repository,
        name="main",
        head_commit_sha="a" * 40,
        is_default=True,
    )
    return repository, branch


def _seed_complete_graph(
    db: Session,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[
    uuid.UUID,
    list[tuple[type[object], uuid.UUID]],
    tuple[uuid.UUID, uuid.UUID],
]:
    repository, branch = _repository(workspace_id)
    engine_version = AnalysisEngineVersion(
        version_identifier=f"cascade-{uuid.uuid4()}",
        tool_versions={},
        rule_set_version="v1",
        extraction_logic_version="v2",
    )
    satd_model = MLModelVersion(
        model_type=MLModelType.SATD,
        version_identifier=f"satd-{uuid.uuid4()}",
        training_date=datetime.now(UTC),
        deployment_status=ModelDeploymentStatus.DEPLOYED,
        evaluation_dataset_reference="cascade-test",
        evaluation_metrics={},
    )
    bug_model = MLModelVersion(
        model_type=MLModelType.BUG_RISK,
        version_identifier=f"bug-{uuid.uuid4()}",
        training_date=datetime.now(UTC),
        deployment_status=ModelDeploymentStatus.DEPLOYED,
        evaluation_dataset_reference="cascade-test",
        evaluation_metrics={},
    )
    db.add_all([repository, branch, engine_version, satd_model, bug_model])
    db.flush()

    attempt = AnalysisAttempt(
        initiated_by_user_id=user_id,
        initiating_workspace_id=workspace_id,
        branch_id=branch.id,
        analysis_engine_version_id=engine_version.id,
        commit_sha="b" * 40,
        trigger_type=AnalysisTriggerType.MANUAL,
        status=AnalysisStatus.DONE,
    )
    db.add(attempt)
    db.flush()
    snapshot = Snapshot(
        analysis_attempt_id=attempt.id,
        commit_sha=attempt.commit_sha,
        scan_time=datetime.now(UTC),
        finding_count=1,
    )
    db.add(snapshot)
    db.flush()

    source_file = SourceFile(
        snapshot_id=snapshot.id,
        relative_path="src/App.java",
        language="java",
    )
    folder = FileTreeNode(
        snapshot_id=snapshot.id,
        name="src",
        node_type=FileTreeNodeType.FOLDER,
    )
    db.add_all([source_file, folder])
    db.flush()
    symbol = CodeSymbol(
        source_file_id=source_file.id,
        name="App",
        symbol_type=CodeSymbolType.CLASS,
    )
    location = SourceLocation(
        source_file_id=source_file.id,
        code_symbol_id=None,
        start_line=1,
        end_line=3,
        start_column=0,
        end_column=1,
    )
    static_metric = StaticMetric(
        source_file_id=source_file.id,
        code_symbol_id=None,
        metric_name="loc",
        value=3,
    )
    process_metric = ProcessMetric(
        source_file_id=source_file.id,
        commits_90d=2,
        author_count=1,
        file_age=30,
        recency=2,
    )
    file_node = FileTreeNode(
        snapshot_id=snapshot.id,
        parent_node_id=folder.id,
        source_file_id=source_file.id,
        name="App.java",
        node_type=FileTreeNodeType.FILE,
    )
    db.add_all([symbol, location, static_metric, process_metric, file_node])
    db.flush()
    location.code_symbol_id = symbol.id

    satd = SATDPrediction(
        source_location_id=location.id,
        category_id="code-design",
        model_version_id=satd_model.id,
        is_debt=True,
        confidence=0.9,
        explanation="test prediction",
    )
    bug = BugRiskPrediction(
        source_file_id=source_file.id,
        model_version_id=bug_model.id,
        risk_score=0.4,
        confidence=0.8,
    )
    score = SnapshotScore(
        snapshot_id=snapshot.id,
        profile_fingerprint="c" * 64,
        scoring_engine_version="v1",
        status="pending",
    )
    db.add_all([satd, bug, score])
    db.flush()
    finding = Finding(
        source_location_id=location.id,
        category_id="code-design",
        rule_id=None,
        satd_prediction_id=satd.id,
        source=FindingSource.SATD,
        severity=Severity.MEDIUM,
        description="test finding",
        evidence=None,
        measured_value=None,
        threshold=None,
        confidence=0.9,
        fingerprint="cascade-finding",
    )
    db.add(finding)
    db.flush()

    descendants: list[object] = [
        repository,
        branch,
        attempt,
        snapshot,
        source_file,
        folder,
        symbol,
        location,
        static_metric,
        process_metric,
        file_node,
        satd,
        bug,
        score,
        finding,
    ]
    return (
        repository.id,
        [(type(record), record.id) for record in descendants],
        (satd_model.id, bug_model.id),
    )


def test_removal_cascades_through_every_repository_owned_record(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    with Session(engine) as db:
        repository_id, descendant_ids, model_ids = _seed_complete_graph(db, workspace_id, user_id)
        db.commit()

    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        set_workspace_context(db, workspace_id)
        repositories.disconnect(db, workspace_id, repository_id, user_id)
        db.commit()

    with Session(engine) as db:
        for model, record_id in descendant_ids:
            assert db.get(model, record_id) is None, model.__name__
        assert all(db.get(MLModelVersion, model_id) is not None for model_id in model_ids)
        audit = db.scalar(
            select(SecurityAuditRecord).where(
                SecurityAuditRecord.workspace_id == workspace_id,
                SecurityAuditRecord.event_type == "repository_disconnected:success",
            )
        )
        assert audit is not None
        assert str(repository_id) in audit.affected_resource


def test_both_queued_and_running_attempts_block_removal(account) -> None:
    engine, _, user_id, workspace_id, _ = account
    protected_repositories: list[uuid.UUID] = []
    with Session(engine) as db:
        engine_version = AnalysisEngineVersion(
            version_identifier=f"active-{uuid.uuid4()}",
            tool_versions={},
            rule_set_version="v1",
            extraction_logic_version="v2",
        )
        db.add(engine_version)
        db.flush()
        for status in (AnalysisStatus.QUEUED, AnalysisStatus.RUNNING):
            repository, branch = _repository(workspace_id)
            db.add_all([repository, branch])
            db.flush()
            db.add(
                AnalysisAttempt(
                    initiated_by_user_id=user_id,
                    initiating_workspace_id=workspace_id,
                    branch_id=branch.id,
                    analysis_engine_version_id=engine_version.id,
                    commit_sha=uuid.uuid4().hex,
                    trigger_type=AnalysisTriggerType.MANUAL,
                    status=status,
                )
            )
            protected_repositories.append(repository.id)
        db.commit()

    for repository_id in protected_repositories:
        with Session(engine) as db:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            set_workspace_context(db, workspace_id)
            with pytest.raises(RepositoryScanRunning):
                repositories.disconnect(db, workspace_id, repository_id, user_id)
            db.rollback()

    with Session(engine) as db:
        assert all(db.get(Repository, repo_id) is not None for repo_id in protected_repositories)


def test_scan_start_and_removal_are_serialized_by_the_repository_lock(
    account,
    monkeypatch,
) -> None:
    engine, _, user_id, workspace_id, _ = account
    with Session(engine) as db:
        repository, branch = _repository(workspace_id)
        db.add_all([repository, branch])
        db.commit()
        repository_id = repository.id

    scan_has_lock = Event()
    release_scan = Event()

    def fetch_after_lock(*_args: object) -> GitHubBranch:
        scan_has_lock.set()
        assert release_scan.wait(timeout=10)
        return GitHubBranch("main", "d" * 40)

    monkeypatch.setattr(analysis, "fetch_branch", fetch_after_lock)
    from codesage_api.tasks.scan_pipeline import run_scan

    monkeypatch.setattr(run_scan, "delay", lambda *_args: None)

    def start_scan() -> AnalysisStatus:
        with Session(engine) as db:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            set_workspace_context(db, workspace_id)
            result = analysis.start(
                db,
                workspace_id,
                repository_id,
                "main",
                actor_user_id=user_id,
            )
            return AnalysisStatus(result.phase.value)

    def remove_repository() -> str:
        with Session(engine) as db:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            set_workspace_context(db, workspace_id)
            try:
                repositories.disconnect(db, workspace_id, repository_id, user_id)
                db.commit()
                return "removed"
            except RepositoryScanRunning:
                db.rollback()
                return "scan-running"

    with ThreadPoolExecutor(max_workers=2) as pool:
        scan = pool.submit(start_scan)
        assert scan_has_lock.wait(timeout=10)
        removal = pool.submit(remove_repository)
        try:
            with pytest.raises(FutureTimeout):
                removal.result(timeout=0.25)
        finally:
            release_scan.set()
        assert scan.result(timeout=10) is AnalysisStatus.QUEUED
        assert removal.result(timeout=10) == "scan-running"

    with Session(engine) as db:
        assert db.get(Repository, repository_id) is not None
        attempt = db.scalar(
            select(AnalysisAttempt).join(Branch).where(Branch.repository_id == repository_id)
        )
        assert attempt is not None
        assert attempt.status is AnalysisStatus.QUEUED


def test_scan_waiting_on_a_winning_removal_returns_not_found(
    account,
    monkeypatch,
) -> None:
    engine, _, user_id, workspace_id, _ = account
    with Session(engine) as db:
        repository, branch = _repository(workspace_id)
        db.add_all([repository, branch])
        db.commit()
        repository_id = repository.id

    removal_has_lock = Event()
    release_removal = Event()

    def audit_after_lock(*_args: object, **_kwargs: object) -> None:
        removal_has_lock.set()
        assert release_removal.wait(timeout=10)

    monkeypatch.setattr(repositories.audit, "record", audit_after_lock)
    monkeypatch.setattr(
        analysis,
        "fetch_branch",
        lambda *_args: pytest.fail("a deleted repository reached GitHub"),
    )

    def remove_repository() -> str:
        with Session(engine) as db:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            set_workspace_context(db, workspace_id)
            repositories.disconnect(db, workspace_id, repository_id, user_id)
            db.commit()
            return "removed"

    def start_scan() -> str:
        with Session(engine) as db:
            db.execute(text("SET LOCAL ROLE codesage_app"))
            set_workspace_context(db, workspace_id)
            try:
                analysis.start(
                    db,
                    workspace_id,
                    repository_id,
                    "main",
                    actor_user_id=user_id,
                )
            except NotFound:
                db.rollback()
                return "not-found"
            return "started"

    with ThreadPoolExecutor(max_workers=2) as pool:
        removal = pool.submit(remove_repository)
        assert removal_has_lock.wait(timeout=10)
        scan = pool.submit(start_scan)
        try:
            with pytest.raises(FutureTimeout):
                scan.result(timeout=0.25)
        finally:
            release_removal.set()
        assert removal.result(timeout=10) == "removed"
        assert scan.result(timeout=10) == "not-found"

    with Session(engine) as db:
        assert db.get(Repository, repository_id) is None
        assert (
            db.scalar(
                select(AnalysisAttempt).join(Branch).where(Branch.repository_id == repository_id)
            )
            is None
        )
