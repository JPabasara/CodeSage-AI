"""Drive the real scan pipeline against PostgreSQL with its outside world stubbed.

Git, the extractors, PMD, both ML services and Redis are replaced; everything
from `_finalize` inward — the ORM, the transaction, RLS, constraints and
grants — is the production code running as `codesage_app`.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.enums import (
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import Branch, Repository
from codesage_api.db.repositories import attempts
from codesage_api.db.rls import set_workspace_context
from codesage_api.detection.fingerprint import rule_fingerprint
from codesage_api.detection.provider import DetectorResult, DetectorStatus
from codesage_api.detection.risk.client import RiskClientResult
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.detection.satd.client import SATDResult
from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.pipeline import ExtractionResult
from codesage_api.extractors.process_metrics import FileProcessMetrics
from codesage_api.guardrails import JavaInventory
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router
from codesage_api.routers import members as members_router
from codesage_api.scoring.enums import Category, Severity
from codesage_api.services import dashboard
from codesage_api.tasks import scan_pipeline, score_cache
from codesage_api.tasks.repository_clone import ClonedRepository

from .support import session_cookie


def app_session(engine: Engine) -> Session:
    db = Session(engine, expire_on_commit=False)
    db.execute(text("SET LOCAL ROLE codesage_app"))
    return db


@contextmanager
def app_scope(engine: Engine) -> Iterator[Session]:
    db = app_session(engine)
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@dataclass(frozen=True, slots=True)
class Issue:
    """One rule finding the stubbed detector reports."""

    path: str
    symbol: str
    rule_id: str = "complex-function"
    line: int = 10

    def detected(self) -> DetectedFinding:
        return DetectedFinding(
            file_path=self.path,
            line=self.line,
            symbol=self.symbol,
            rule_id=self.rule_id,
            category=Category.CODE_DESIGN,
            severity=Severity.MEDIUM,
            description=f"{self.symbol}() is too complex",
            evidence=None,
            measured_value=20.0,
            threshold=15.0,
            fingerprint=rule_fingerprint(self.rule_id, self.path, self.symbol),
        )


@dataclass
class ScanWorld:
    """What the next scan will "find". Tests mutate it between scans."""

    files: list[str] = field(default_factory=lambda: ["src/App.java", "src/Util.java"])
    issues: list[Issue] = field(default_factory=list)
    process_metrics: list[FileProcessMetrics] = field(default_factory=list)
    risk_result: RiskClientResult | None = None
    satd_predictions: list[SATDResult] = field(default_factory=list)
    # Raise inside a stage: {"extract": SoftTimeLimitExceeded(), ...}
    fail_at: dict[str, BaseException] = field(default_factory=dict)

    def extraction(self) -> ExtractionResult:
        return ExtractionResult(
            static_metrics=[
                FileMetrics(
                    path=path, loc=120, cyclomatic_complexity=12.0, max_nesting_depth=2,
                    method_count=4, longest_method_lines=30, cbo=1.0, dit=1.0, lcom=0.0,
                    rfc=3.0, noc=0.0,
                )
                for path in self.files
            ],
            class_metrics=[],
            process_metrics=self.process_metrics,
            comments=[],
        )


@dataclass
class Tenant:
    engine: Engine
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    session_id: uuid.UUID
    repository_id: uuid.UUID
    branch_id: uuid.UUID
    world: ScanWorld


def add_repository(engine: Engine, workspace_id: uuid.UUID, name: str = "app") -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as db:
        repository = Repository(
            workspace_id=workspace_id,
            source_platform=RepositoryPlatform.GITHUB,
            external_repository_id=str(uuid.uuid4()),
            name=name,
            owner="acme",
            url=f"https://github.com/acme/{name}",
            visibility=RepositoryVisibility.PUBLIC,
            connection_status=RepositoryConnectionStatus.CONNECTED,
        )
        branch = Branch(repository=repository, name="main", head_commit_sha="0" * 40, is_default=True)
        db.add_all([repository, branch])
        db.commit()
        return repository.id, branch.id


def stub_outside_world(monkeypatch: pytest.MonkeyPatch, engine: Engine, world: ScanWorld) -> None:
    """Replace every non-database dependency of `run_scan` and the scorer."""

    def stage(name: str, value: Callable[[], object]) -> Callable[..., object]:
        def run(*_args: object, **_kwargs: object) -> object:
            if name in world.fail_at:
                raise world.fail_at[name]
            return value()

        return run

    monkeypatch.setattr(scan_pipeline, "session_scope", lambda: app_scope(engine))
    monkeypatch.setattr(score_cache, "session_scope", lambda: app_scope(engine))
    monkeypatch.setattr(
        scan_pipeline,
        "clone_at_commit",
        lambda _url, sha, _attempt, *, branch: ClonedRepository(
            Path("/nonexistent"), sha, datetime.now(UTC)
        ),
    )
    monkeypatch.setattr(
        scan_pipeline, "check_java_sources", lambda _path: JavaInventory(files=1, lines=1)
    )
    monkeypatch.setattr(scan_pipeline, "extract", stage("extract", world.extraction))
    monkeypatch.setattr(
        scan_pipeline, "detect", stage("detect", lambda: [item.detected() for item in world.issues])
    )
    monkeypatch.setattr(
        scan_pipeline,
        "run_optional_detector",
        stage("detector", lambda: DetectorResult(DetectorStatus.OK)),
    )
    monkeypatch.setattr(
        scan_pipeline.risk_client, "predict", stage("risk", lambda: world.risk_result)
    )
    monkeypatch.setattr(
        scan_pipeline, "classify", stage("satd", lambda: world.satd_predictions)
    )
    monkeypatch.setattr(scan_pipeline.cancel, "check", stage("cancel", lambda: None))
    monkeypatch.setattr(scan_pipeline.cancel, "cleanup", lambda *_args: None)
    monkeypatch.setattr(scan_pipeline.progress, "publish_progress", lambda *_args: None)
    monkeypatch.setattr("codesage_api.services.analysis.progress.read_progress", lambda _id: 0)
    monkeypatch.setattr(
        "codesage_api.services.analysis.progress.request_cancel", lambda _id: None
    )

    def send_task(name: str, args: list[object]) -> None:
        # Scoring runs inline, so one extra read shows its result.
        if name == "codesage.score_snapshot":
            score_cache.score_snapshot(*args)

    monkeypatch.setattr(scan_pipeline.celery_app, "send_task", send_task)
    monkeypatch.setattr(dashboard.celery_app, "send_task", send_task)


def queue_scan(tenant: Tenant, commit_sha: str) -> uuid.UUID:
    with app_scope(tenant.engine) as db:
        set_workspace_context(db, tenant.workspace_id)
        attempt = attempts.create_queued(
            db, tenant.branch_id, commit_sha,
            actor_user_id=tenant.user_id, workspace_id=tenant.workspace_id,
        )
        return attempt.id


def run_scan(tenant: Tenant, commit_sha: str) -> uuid.UUID:
    """Queue and run one scan to its terminal state; returns the attempt id."""
    attempt_id = queue_scan(tenant, commit_sha)
    scan_pipeline.run_scan(str(attempt_id), str(tenant.workspace_id))
    return attempt_id


def api_client(engine: Engine, session_id: uuid.UUID, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    def factory() -> Session:
        return app_session(engine)

    monkeypatch.setattr(deps, "SessionLocal", factory)
    monkeypatch.setattr(auth_router, "SessionLocal", factory)
    monkeypatch.setattr(members_router, "SessionLocal", factory)
    client = TestClient(create_app())
    client.cookies.set(get_settings().session_cookie_name, session_cookie(engine, session_id))
    return client


def read_scored(client: TestClient, path: str, **params: object) -> object:
    """GET a profile-scored read, letting the inline scorer fill the cache first."""
    for _ in range(3):
        response = client.get(path, params=params)
        if response.status_code == 503 and response.json()["code"] == "SCORE_PENDING":
            continue
        assert response.status_code == 200, response.text
        return response.json()
    raise AssertionError(f"{path} never finished scoring")


@pytest.fixture
def tenant(account, monkeypatch) -> Tenant:
    """A signed-in org-admin with one connected repository and a stubbed scanner."""
    engine, _claims, user_id, workspace_id, session_id = account
    repository_id, branch_id = add_repository(engine, workspace_id)
    world = ScanWorld()
    stub_outside_world(monkeypatch, engine, world)
    return Tenant(engine, user_id, workspace_id, session_id, repository_id, branch_id, world)


def history(client: TestClient, tenant: Tenant) -> list[dict[str, object]]:
    """Scan history, read twice so the inline scorer fills every row."""
    path = f"/api/repos/{tenant.repository_id}/scans"
    client.get(path, params={"branch": "main"})
    response = client.get(path, params={"branch": "main"})
    assert response.status_code == 200, response.text
    return response.json()


def health(client: TestClient, tenant: Tenant, **params: object) -> dict[str, object]:
    return read_scored(  # type: ignore[return-value]
        client, f"/api/repos/{tenant.repository_id}/health", branch="main", **params
    )


def sign_in(client: TestClient, monkeypatch: pytest.MonkeyPatch, claims) -> str:
    """Complete the real callback with Asgardeo's code exchange stubbed.

    Returns the raw session cookie the browser received and leaves it set on
    the client. Secure cookies are not replayed over the test client's http://,
    so the jar is filled explicitly.
    """
    monkeypatch.setattr(
        auth_router.auth_service, "exchange_code_for_identity", lambda _code, _verifier: claims
    )
    state = "state-" + uuid.uuid4().hex
    client.cookies.set(
        auth_router.HANDSHAKE_COOKIE,
        auth_router._signer().dumps({"state": state, "verifier": "verifier"}),
    )
    response = client.get(
        "/api/auth/callback", params={"code": "code", "state": state}, follow_redirects=False
    )
    assert response.status_code == 302, response.text
    name = get_settings().session_cookie_name
    raw = response.cookies.get(name)
    assert raw, response.headers.get("set-cookie")
    client.cookies.clear()
    client.cookies.set(name, raw)
    return raw
