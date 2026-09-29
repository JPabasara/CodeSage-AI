"""Database-requirement scenarios that need explicit persisted-row assertions."""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.db.models import (
    Branch,
    BugRiskPrediction,
    Finding,
    ProcessMetric,
    Repository,
    SATDPrediction,
    Snapshot,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.satd.client import SATDResult
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.extractors.process_metrics import FileProcessMetrics
from codesage_api.integrations.github import GitHubBranch, GitHubRepository
from codesage_api.scoring.enums import Category
from codesage_api.services import analysis, repositories

from .scans import Issue, api_client, run_scan
from .scans import tenant as tenant  # noqa: PLC0414
from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414


def test_connected_repository_metadata_and_default_branch_are_persisted(
    tenant, monkeypatch
) -> None:
    metadata = GitHubRepository(
        "external-42", "billing", "acme", "https://github.com/acme/billing",
        "public", "trunk", "a" * 40,
    )
    monkeypatch.setattr(repositories, "fetch_repository", lambda _url: metadata)
    monkeypatch.setattr(repositories.celery_app, "send_task", lambda *_a, **_k: None)
    client = api_client(tenant.engine, tenant.session_id, monkeypatch)

    response = client.post("/api/projects", json={"url": metadata.url})
    assert response.status_code == 201, response.text
    with Session(tenant.engine) as db:
        stored = db.scalar(
            select(Repository).where(Repository.external_repository_id == metadata.external_id)
        )
        branch = db.scalar(select(Branch).where(Branch.repository_id == stored.id))
        assert (stored.source_platform.value, stored.owner, stored.name, stored.url) == (
            "github", metadata.owner, metadata.name, metadata.url
        )
        assert stored.visibility.value == metadata.visibility
        assert (branch.name, branch.head_commit_sha, branch.is_default) == (
            metadata.default_branch, metadata.default_branch_sha, True
        )


def test_unchanged_branch_returns_latest_done_attempt_without_queuing(
    tenant, monkeypatch
) -> None:
    first = run_scan(tenant, "b" * 40)
    monkeypatch.setattr(
        analysis, "fetch_branch", lambda *_args: GitHubBranch("main", "b" * 40)
    )
    delayed: list[object] = []
    monkeypatch.setattr(
        "codesage_api.tasks.scan_pipeline.run_scan.delay", lambda *args: delayed.append(args)
    )
    with Session(tenant.engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        db.execute(
            text("SELECT set_config('app.current_workspace_id', :w, true)"),
            {"w": str(tenant.workspace_id)},
        )
        returned = analysis.start(
            db, tenant.workspace_id, tenant.repository_id, "main",
            actor_user_id=tenant.user_id,
        )
    assert returned.scan_id == str(first)
    assert delayed == []
    with Session(tenant.engine) as db:
        assert db.scalar(
            text("SELECT count(*) FROM analysis_attempt WHERE branch_id=:b"),
            {"b": tenant.branch_id},
        ) == 1
        indexes = set(
            db.scalars(
                text("SELECT indexname FROM pg_indexes WHERE tablename='analysis_attempt'")
            )
        )
    assert "ix_analysis_attempt_branch_commit" in indexes


def test_scan_persists_source_files_metrics_locations_and_process_history(tenant) -> None:
    tenant.world.files = ["src/App.java", "src/Util.java", "src/More.java"]
    tenant.world.issues = [Issue("src/App.java", "calculate", line=17)]
    tenant.world.process_metrics = [
        FileProcessMetrics(
            path="src/App.java", commits_90d=2, number_of_versions_until=5,
            number_of_authors_until=3, lines_added_until=100, max_lines_added_until=40,
            avg_lines_added_until=20.0, lines_removed_until=25, max_lines_removed_until=10,
            avg_lines_removed_until=5.0, code_churn_until=75, max_code_churn_until=35,
            avg_code_churn_until=15.0, age_with_respect_to=12.0,
            weighted_age_with_respect_to=7.5,
        )
    ]
    attempt = run_scan(tenant, "c" * 40)
    with Session(tenant.engine) as db:
        snapshot = db.scalar(select(Snapshot).where(Snapshot.analysis_attempt_id == attempt))
        files = list(db.scalars(select(SourceFile).where(SourceFile.snapshot_id == snapshot.id)))
        assert {(f.relative_path, f.language) for f in files} == {
            (path, "java") for path in tenant.world.files
        }
        app = next(f for f in files if f.relative_path == "src/App.java")
        metrics = {
            name: value
            for name, value in db.execute(
                select(StaticMetric.metric_name, StaticMetric.value).where(
                    StaticMetric.source_file_id == app.id
                )
            ).all()
        }
        assert metrics == {
            "loc": 120.0, "wmc": 12.0, "max_nested_blocks": 2.0,
            "total_methods": 4.0, "longest_method_loc": 30.0,
        }
        process = db.scalar(
            select(ProcessMetric).where(ProcessMetric.source_file_id == app.id)
        )
        assert (process.commits_90d, process.number_of_versions_until,
                process.number_of_authors_until, process.code_churn_until) == (2, 5, 3, 75)
        finding = db.scalar(select(Finding).where(Finding.snapshot_id == snapshot.id))
        location = db.get(SourceLocation, finding.source_location_id)
        assert location.source_file_id == app.id
        assert (location.start_line, location.end_line) == (17, 17)
        assert (location.start_column, location.end_column) == (0, 0)


def test_scan_persists_satd_and_bug_risk_prediction_provenance(tenant) -> None:
    tenant.world.files = ["src/App.java"]
    tenant.world.risk_result = RiskClientResult(
        class_scores={}, file_scores={"src/App.java": 0.73}, model_version="risk-v1"
    )
    tenant.world.satd_predictions = [
        SATDResult(
            comment=ExtractedComment("src/App.java", 8, "// TODO split this class"),
            is_debt=True, category=Category.CODE_DESIGN, confidence=0.91,
            model_version="satd-v1",
        )
    ]
    attempt = run_scan(tenant, "d" * 40)
    with Session(tenant.engine) as db:
        snapshot = db.scalar(select(Snapshot).where(Snapshot.analysis_attempt_id == attempt))
        bug = db.scalar(
            select(BugRiskPrediction).join(SourceFile).where(SourceFile.snapshot_id == snapshot.id)
        )
        satd = db.scalar(
            select(SATDPrediction).join(SourceLocation).join(SourceFile).where(
                SourceFile.snapshot_id == snapshot.id
            )
        )
        finding = db.scalar(
            select(Finding).where(Finding.snapshot_id == snapshot.id, Finding.source == "satd")
        )
        assert (bug.risk_score, bug.confidence, bug.model_version.version_identifier) == (
            0.73, None, "risk-v1"
        )
        assert (satd.is_debt, satd.confidence, satd.model_version.version_identifier) == (
            True, 0.91, "satd-v1"
        )
        assert finding.satd_prediction_id == satd.id
        assert finding.confidence == 0.91
        assert finding.evidence == "// TODO split this class"


def test_database_does_not_persist_repository_source_text(tenant) -> None:
    marker = "UNIQUE_SOURCE_BODY_" + uuid.uuid4().hex
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    run_scan(tenant, "e" * 40)
    # The marker represents an ordinary source body and is never passed as SATD evidence.
    with Session(tenant.engine) as db:
        forbidden_columns = db.execute(
            text(
                "SELECT table_name,column_name FROM information_schema.columns "
                "WHERE table_schema='public' AND "
                "(column_name ILIKE '%source_code%' OR column_name ILIKE '%file_content%' "
                "OR column_name ILIKE '%source_content%')"
            )
        ).all()
        assert forbidden_columns == []
        text_columns = db.execute(
            text(
                "SELECT table_name,column_name FROM information_schema.columns "
                "WHERE table_schema='public' AND data_type IN "
                "('text','character varying','json','jsonb')"
            )
        ).all()
        hits = []
        for table, column in text_columns:
            count = db.scalar(
                text(f'SELECT count(*) FROM "{table}" WHERE "{column}"::text LIKE :marker'),
                {"marker": f"%{marker}%"},
            )
            if count:
                hits.append(f"{table}.{column}")
    assert hits == []


def test_schema_catalogues_are_extensible_data(tenant) -> None:
    with Session(tenant.engine) as db:
        before = db.scalar(text("SELECT count(*) FROM snapshot"))
        db.execute(
            text("INSERT INTO debt_category VALUES ('architecture','Architecture')")
        )
        db.execute(
            text(
                "INSERT INTO rule_definition "
                "(rule_id,category_id,threshold,severity,message_template) "
                "VALUES ('architecture-cycle','architecture',1,'high','Cycle detected')"
            )
        )
        db.execute(
            text(
                "INSERT INTO ml_model_version "
                "(id,model_type,version_identifier,training_date,deployment_status,"
                "evaluation_dataset_reference,evaluation_metrics) "
                "VALUES (gen_random_uuid(),'bug_risk','extensible-v1',now(),'evaluating',"
                "'test','{}')"
            )
        )
        db.commit()
    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(*) FROM snapshot")) == before
        assert db.scalar(text("SELECT count(*) FROM rule_definition WHERE category_id='architecture'")) == 1
        assert db.scalar(text("SELECT count(*) FROM ml_model_version WHERE version_identifier='extensible-v1'")) == 1
