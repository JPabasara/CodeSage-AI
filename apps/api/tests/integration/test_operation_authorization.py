"""Production route inventory, permission enforcement, and scan provenance."""

import json
import uuid
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt, Branch, Membership, Repository, User, Workspace
from codesage_api.db.repositories import attempts
from codesage_api.db.rls import set_workspace_context
from codesage_api.integrations.github import GitHubBranch
from codesage_api.main import create_app
from codesage_api.services import analysis, dashboard, profiles, repositories

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414

PROFILE = {
    "weights": {"security": 1, "code_design": 1, "requirement": 1, "documentation": 1, "test": 1},
    "trust_s": 0.5,
}

# All workspace business operations. Auth/session is identity-only; login,
# callback, logout, healthz and the two unimplemented ops probes are public.
INVENTORY = {
    ("GET", "/api/projects"): "project:read",
    ("POST", "/api/projects"): "repository:connect",
    ("GET", "/api/repos/{repo_id}/branches"): "repository:read",
    ("POST", "/api/repos/{repo_id}/scan"): "scan:start",
    ("GET", "/api/repos/{repo_id}/scan/{scan_id}"): "result:read",
    ("POST", "/api/repos/{repo_id}/scan/{scan_id}/stop"): "scan:cancel_own|scan:cancel_any",
    ("GET", "/api/repos/{repo_id}/scans"): "history:read",
    ("GET", "/api/repos/{repo_id}/health"): "result:read",
    ("GET", "/api/profiles"): "profile:read",
    ("GET", "/api/profiles/active"): "profile:read",
    ("PUT", "/api/profiles/active"): "profile:update",
}


def test_route_inventory_has_no_unclassified_operations():
    actual = {
        (method.upper(), path)
        for path, operations in create_app().openapi()["paths"].items()
        for method in operations
        if method in {"get", "post", "put", "delete", "patch"}
    }
    exceptions = {
        ("GET", "/api/auth/login"),
        ("GET", "/api/auth/callback"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/auth/session"),
        ("GET", "/api/auth/workspaces"),
        ("PUT", "/api/auth/workspaces/active"),
        ("GET", "/api/healthz"),
        ("GET", "/readyz"),
        ("GET", "/version"),
    }
    assert actual == set(INVENTORY) | exceptions


def make_repo(db, workspace):
    repo = Repository(
        workspace_id=workspace,
        source_platform="github",
        external_repository_id=str(uuid.uuid4()),
        name="example",
        owner="acme",
        url="https://github.com/acme/example",
        visibility="public",
        connection_status="connected",
    )
    db.add(repo)
    db.flush()
    branch = Branch(repository_id=repo.id, name="main", head_commit_sha="old", is_default=True)
    db.add(branch)
    db.flush()
    return repo, branch


@pytest.fixture
def resources(account):
    engine, _, user, workspace, _ = account
    with Session(engine) as db:
        repo, branch = make_repo(db, workspace)
        other_repo, _ = make_repo(db, workspace)
        foreign_workspace = Workspace()
        db.add(foreign_workspace)
        db.flush()
        foreign_repo, foreign_branch = make_repo(db, foreign_workspace.id)
        other_user = User(asgardeo_sub=str(uuid.uuid4()))
        db.add(other_user)
        db.flush()
        own = attempts.create_queued(db, branch.id, "a", actor_user_id=user, workspace_id=workspace)
        other = attempts.create_queued(
            db, branch.id, "b", actor_user_id=other_user.id, workspace_id=workspace
        )
        legacy = attempts.create_queued(
            db, branch.id, "c", actor_user_id=user, workspace_id=workspace
        )
        legacy.initiated_by_user_id = None
        foreign = attempts.create_queued(
            db,
            foreign_branch.id,
            "d",
            actor_user_id=other_user.id,
            workspace_id=foreign_workspace.id,
        )
        result = {
            "repo": repo.id,
            "branch": branch.id,
            "other_repo": other_repo.id,
            "foreign_repo": foreign_repo.id,
            "own": own.id,
            "other": other.id,
            "legacy": legacy.id,
            "foreign": foreign.id,
        }
        db.commit()
    return result


@pytest.fixture
def client(account, monkeypatch):
    def application_session():
        db = Session(account[0])
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    with TestClient(create_app()) as http:
        http.cookies.set(get_settings().session_cookie_name, str(account[4]))
        yield http


def set_role(account, role):
    with Session(account[0]) as db:
        member = db.scalar(select(Membership).where(Membership.user_id == account[2]))
        member.role_id = role
        db.commit()


def request_args(method, path):
    if path.endswith("/health"):
        return {"params": {"branch": "main"}}
    if method == "POST" and path == "/api/projects":
        return {"json": {"url": "https://github.com/acme/example"}}
    if method == "POST" and path.endswith("/scan"):
        return {"json": {"branch": "main"}}
    if method == "PUT":
        return {"json": PROFILE}
    if method == "POST" and path == "/api/invitations":
        return {"json": {"email": "invitee@example.com", "role": "viewer"}}
    if method == "PATCH" and path.endswith("/role"):
        return {"json": {"role": "viewer"}}
    return {}


@pytest.mark.parametrize("role", ["org-admin", "manager", "developer", "viewer"])
def test_every_operation_checks_role_before_business_service(
    account, resources, client, monkeypatch, role
):
    set_role(account, role)
    entered = []

    def reached(*args, **kwargs):
        entered.append(True)
        raise HTTPException(418, "Reached authorized business service")

    for module, names in [
        (repositories, ["list_projects", "connect", "list_branches"]),
        (analysis, ["start", "get_status", "cancel", "get_history"]),
        (profiles, ["list_available", "get_active_output", "apply"]),
        (dashboard, ["build_health_report"]),
    ]:
        for name in names:
            monkeypatch.setattr(module, name, reached)
    policy = json.loads(
        (
            Path(__file__).resolve().parents[2] / "src/codesage_api/authorization/policy.json"
        ).read_text()
    )
    grants = policy["roles"][role]
    for (method, template), permission in INVENTORY.items():
        path = template.format(
            repo_id=resources["repo"],
            scan_id=resources["own"],
            invitation_id=uuid.uuid4(),
            membership_id=uuid.uuid4(),
        )
        before = len(entered)
        response = client.request(method, path, **request_args(method, path))
        allowed = any(value in grants for value in permission.split("|"))
        assert response.status_code == (418 if allowed else 403), (method, path, response.text)
        assert len(entered) == before + int(allowed)


@pytest.mark.parametrize("role", ["org-admin", "manager", "developer", "viewer"])
def test_cancellation_own_other_and_legacy(account, resources, client, monkeypatch, role):
    set_role(account, role)
    cancel = Mock()
    monkeypatch.setattr(analysis.progress, "request_cancel", cancel)
    for kind in ("own", "other", "legacy"):
        cancel.reset_mock()
        response = client.post(f"/api/repos/{resources['repo']}/scan/{resources[kind]}/stop")
        allowed = role in {"org-admin", "manager"} or (role == "developer" and kind == "own")
        assert response.status_code == (200 if allowed else 403), response.text
        assert cancel.call_count == int(allowed)


def test_foreign_resources_are_404_before_work(account, resources, client, monkeypatch):
    set_role(account, "viewer")
    side_effect = Mock(side_effect=AssertionError("Denied request reached business service"))
    monkeypatch.setattr(analysis, "start", side_effect)
    monkeypatch.setattr(analysis, "cancel", side_effect)
    monkeypatch.setattr(analysis, "get_status", side_effect)
    monkeypatch.setattr(dashboard, "build_health_report", side_effect)
    for method, template in INVENTORY:
        if "{repo_id}" not in template:
            continue
        path = template.format(repo_id=resources["foreign_repo"], scan_id=resources["foreign"])
        response = client.request(method, path, **request_args(method, path))
        assert response.status_code == 404, (path, response.text)
    for scan in (resources["foreign"], uuid.uuid4()):
        response = client.post(f"/api/repos/{resources['repo']}/scan/{scan}/stop")
        assert response.status_code == 404
    # A real scan from another repository in the same workspace is also hidden.
    assert (
        client.post(
            f"/api/repos/{resources['other_repo']}/scan/{resources['own']}/stop"
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/repos/{resources['repo']}/health",
            params={"branch": "main", "snapshot_id": str(uuid.uuid4())},
        ).status_code
        == 404
    )
    side_effect.assert_not_called()


def test_denied_writes_leave_database_and_queues_unchanged(account, resources, client, monkeypatch):
    from codesage_api.db.models import ScoringProfile
    from codesage_api.routers.profiles import celery_app
    from codesage_api.tasks.scan_pipeline import run_scan

    set_role(account, "viewer")
    queue, scoring_queue, github = Mock(), Mock(), Mock()
    monkeypatch.setattr(run_scan, "delay", queue)
    monkeypatch.setattr(celery_app, "send_task", scoring_queue)
    monkeypatch.setattr(analysis, "fetch_branch", github)
    monkeypatch.setattr(repositories, "fetch_repository", github)
    with Session(account[0]) as db:
        count = db.scalar(select(func.count()).select_from(AnalysisAttempt))
        repo_count = db.scalar(select(func.count()).select_from(Repository))
        weight = db.scalar(select(ScoringProfile.security_weight))
    assert (
        client.post(f"/api/repos/{resources['repo']}/scan", json={"branch": "main"}).status_code
        == 403
    )
    assert (
        client.post("/api/projects", json={"url": "https://github.com/acme/new"}).status_code == 403
    )
    assert client.put("/api/profiles/active", json=PROFILE).status_code == 403
    with Session(account[0]) as db:
        assert db.scalar(select(func.count()).select_from(AnalysisAttempt)) == count
        assert db.scalar(select(func.count()).select_from(Repository)) == repo_count
        assert db.scalar(select(ScoringProfile.security_weight)) == weight
    for mock in (queue, scoring_queue, github):
        mock.assert_not_called()


def test_scan_records_actor_and_worker_continues_after_role_change(
    account, resources, client, monkeypatch
):
    from codesage_api.tasks.scan_pipeline import run_scan

    with Session(account[0]) as db:
        for attempt in db.scalars(select(AnalysisAttempt)):
            attempt.status = AnalysisStatus.DONE
        db.commit()
    set_role(account, "developer")
    queue = Mock()
    monkeypatch.setattr(run_scan, "delay", queue)
    monkeypatch.setattr(analysis, "fetch_branch", lambda *args: GitHubBranch("main", "new-sha"))
    response = client.post(f"/api/repos/{resources['repo']}/scan", json={"branch": "main"})
    assert response.status_code == 202, response.text
    scan_id = uuid.UUID(response.json()["scan_id"])
    queue.assert_called_once_with(str(scan_id), str(account[3]))
    with Session(account[0]) as db:
        record = db.get(AnalysisAttempt, scan_id)
        assert record.initiated_by_user_id == account[2]
        assert record.initiating_workspace_id == account[3]
    set_role(account, "viewer")
    with Session(account[0]) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        set_workspace_context(db, account[3])
        assert attempts.begin_for_worker(db, account[3], scan_id) is not None
        db.commit()
    assert (
        client.post(f"/api/repos/{resources['repo']}/scan", json={"branch": "main"}).status_code
        == 403
    )
    assert queue.call_count == 1


def test_all_operations_deny_when_role_grants_are_revoked(account, resources, client, monkeypatch):
    from sqlalchemy import delete

    from codesage_api.db.models import RolePermission

    with Session(account[0]) as db:
        db.execute(delete(RolePermission).where(RolePermission.role_id == "org-admin"))
        db.commit()

    def forbidden_service(*args, **kwargs):
        raise AssertionError("Operation without a grant reached business logic")

    for module, names in [
        (repositories, ["list_projects", "connect", "list_branches"]),
        (analysis, ["start", "get_status", "cancel", "get_history"]),
        (profiles, ["list_available", "get_active_output", "apply"]),
        (dashboard, ["build_health_report"]),
    ]:
        for name in names:
            monkeypatch.setattr(module, name, forbidden_service)
    for method, template in INVENTORY:
        path = template.format(
            repo_id=resources["repo"],
            scan_id=resources["own"],
            invitation_id=uuid.uuid4(),
            membership_id=uuid.uuid4(),
        )
        response = client.request(method, path, **request_args(method, path))
        assert response.status_code == 403, (path, response.text)


def test_initiator_migration_preserves_unknown_legacy_ownership(database):
    from alembic import command
    from sqlalchemy import inspect

    config, _, engine = database
    command.upgrade(config, "20260921_0010")
    workspace = uuid.uuid4()
    attempt_id = uuid.uuid4()
    with Session(engine) as db:
        db.add(Workspace(id=workspace))
        db.flush()
        _, branch = make_repo(db, workspace)
        version = attempts.get_or_create_engine_version(db)
        db.execute(
            text(
                "INSERT INTO analysis_attempt (id, branch_id, analysis_engine_version_id, "
                "commit_sha, trigger_type, status) VALUES (:id, :branch, :version, 'old', 'manual', 'queued')"
            ),
            {"id": attempt_id, "branch": branch.id, "version": version.id},
        )
        db.commit()
    command.upgrade(config, "head")
    with Session(engine) as db:
        record = db.get(AnalysisAttempt, attempt_id)
        assert record.initiated_by_user_id is None
        assert record.initiating_workspace_id is None
    command.downgrade(config, "20260921_0010")
    assert "initiated_by_user_id" not in {
        c["name"] for c in inspect(engine).get_columns("analysis_attempt")
    }
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(AnalysisAttempt, attempt_id) is not None
