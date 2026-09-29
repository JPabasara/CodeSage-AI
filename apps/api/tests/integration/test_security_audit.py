"""DBR-30: every security-relevant event leaves exactly one complete audit row."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, SecurityAuditRecord, User, Workspace
from codesage_api.integrations.github import GitHubBranch, GitHubRepository
from codesage_api.routers import members as members_router
from codesage_api.services import analysis, repositories
from codesage_api.services.auth import IdentityClaims

from .scans import Tenant, api_client, app_session, queue_scan, sign_in
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

PROFILE = {
    "name": "Audit gate",
    "weights": {"security": 2, "code_design": 1, "requirement": 1, "documentation": 1, "test": 1},
    "trust_s": 0.5,
}


@dataclass
class Case:
    event: str
    outcome: str
    act: Callable[..., None]
    # Events that happen before a workspace exists are system-scoped.
    system_scope: bool = False


def _connect(client, tenant, monkeypatch) -> None:
    monkeypatch.setattr(
        repositories,
        "fetch_repository",
        lambda url: GitHubRepository(
            str(uuid.uuid4()), "lib", "acme", url, "public", "main", "c" * 40
        ),
    )
    response = client.post("/api/projects", json={"url": "https://github.com/acme/lib"})
    assert response.status_code == 201, response.text


def _disconnect(client, tenant, monkeypatch) -> None:
    assert client.delete(f"/api/projects/{tenant.repository_id}").status_code == 204


def _profile_create(client, tenant, monkeypatch) -> None:
    assert client.post("/api/profiles", json=PROFILE).status_code == 201


def _profile_id(client) -> str:
    created = client.post("/api/profiles", json={**PROFILE, "name": f"p-{uuid.uuid4().hex[:6]}"})
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _invite(client, tenant, monkeypatch) -> None:
    response = client.post("/api/invitations", json={"email": "new@example.test", "role": "viewer"})
    assert response.status_code == 201, response.text


def _second_member(tenant) -> uuid.UUID:
    with Session(tenant.engine) as db:
        user = User(asgardeo_sub=str(uuid.uuid4()))
        db.add(user)
        db.flush()
        membership = Membership(
            user_id=user.id, workspace_id=tenant.workspace_id,
            status=MembershipStatus.ACTIVE, role_id="viewer",
        )
        db.add(membership)
        db.commit()
        return membership.id


def _role_change(client, tenant, monkeypatch) -> None:
    membership = _second_member(tenant)
    response = client.patch(f"/api/members/{membership}/role", json={"role": "developer"})
    assert response.status_code == 200, response.text


def _sign_in_success(client, tenant, monkeypatch) -> None:
    sign_in(client, monkeypatch, IdentityClaims(str(uuid.uuid4()), None, None, None, None))


def _sign_in_failure(client, tenant, monkeypatch) -> None:
    client.cookies.clear()
    response = client.get("/api/auth/callback?code=x&state=y", follow_redirects=False)
    assert response.status_code == 302  # back to login: the handshake is missing


def _sign_out(client, tenant, monkeypatch) -> None:
    assert client.post("/api/auth/logout", follow_redirects=False).status_code == 302


def _switch(client, tenant, monkeypatch) -> None:
    created = client.post("/api/auth/workspaces", json={"name": "Second"})
    assert created.status_code == 201, created.text
    response = client.put(
        "/api/auth/workspaces/active", json={"workspace_id": str(tenant.workspace_id)}
    )
    assert response.status_code == 200, response.text


def _scan_start(client, tenant, monkeypatch) -> None:
    from codesage_api.tasks.scan_pipeline import run_scan

    monkeypatch.setattr(analysis, "fetch_branch", lambda *_args: GitHubBranch("main", "d" * 40))
    monkeypatch.setattr(run_scan, "delay", lambda *_args: None)
    response = client.post(f"/api/repos/{tenant.repository_id}/scan", json={"branch": "main"})
    assert response.status_code == 202, response.text


def _scan_cancel(client, tenant, monkeypatch) -> None:
    attempt = queue_scan(tenant, "e" * 40)
    response = client.post(f"/api/repos/{tenant.repository_id}/scan/{attempt}/stop")
    assert response.status_code == 200, response.text


def _finish_scans(client, tenant, monkeypatch) -> None:
    """Removal is refused while a scan is active; settle them as the worker would."""
    with Session(tenant.engine) as db:
        db.execute(text("UPDATE analysis_attempt SET status = 'cancelled' WHERE status IN ('queued', 'running')"))
        db.commit()


def _denied(client, tenant, monkeypatch) -> None:
    with Session(tenant.engine) as db:
        db.execute(
            text("UPDATE membership SET role_id = 'viewer' WHERE user_id = :u"),
            {"u": tenant.user_id},
        )
        db.commit()
    assert client.post("/api/profiles", json=PROFILE).status_code == 403


CASES = [
    Case("repository_connected", "success", _connect),
    Case("repository_disconnected", "success", _disconnect),
    Case("profile_created", "success", _profile_create),
    Case("invitation_created", "success", _invite),
    Case("member_role_changed", "success", _role_change),
    Case("sign_in", "success", _sign_in_success, system_scope=True),
    Case("sign_in", "failure", _sign_in_failure, system_scope=True),
    Case("sign_out", "success", _sign_out),
    Case("workspace_switched", "success", _switch),
    Case("scan_started", "success", _scan_start),
    Case("scan_cancelled", "success", _scan_cancel),
    Case("operation_denied", "denied", _denied),
]


def _rows(engine, event: str, outcome: str) -> list[SecurityAuditRecord]:
    with Session(engine) as db:
        return list(
            db.scalars(
                select(SecurityAuditRecord).where(
                    SecurityAuditRecord.event_type == event,
                    SecurityAuditRecord.outcome == outcome,
                )
            )
        )


@pytest.fixture
def client(tenant, monkeypatch):
    monkeypatch.setattr(members_router, "send_workspace_invitation", lambda **_kwargs: None)
    monkeypatch.setattr(repositories.celery_app, "send_task", lambda *_a, **_k: None)
    return api_client(tenant.engine, tenant.session_id, monkeypatch)


@pytest.mark.parametrize("case", CASES, ids=lambda case: f"{case.event}:{case.outcome}")
def test_event_writes_exactly_one_complete_row(case: Case, tenant: Tenant, client, monkeypatch) -> None:
    before = {row.id for row in _rows(tenant.engine, case.event, case.outcome)}
    started = datetime.now(UTC) - timedelta(seconds=5)

    case.act(client, tenant, monkeypatch)

    new = [row for row in _rows(tenant.engine, case.event, case.outcome) if row.id not in before]
    assert len(new) == 1, [(row.event_type, row.affected_resource) for row in new]
    row = new[0]
    assert row.timestamp.utcoffset() == timedelta(0)
    assert started <= row.timestamp <= datetime.now(UTC) + timedelta(seconds=5)
    assert row.affected_resource
    assert row.actor_identity
    if case.system_scope:
        # A brand-new identity has no workspace; the event is kept regardless.
        assert case.outcome == "failure" or row.actor_identity != "anonymous"
    else:
        assert row.workspace_id == tenant.workspace_id
        assert row.actor_identity == str(tenant.user_id)


def test_profile_update_and_delete_are_audited(tenant, client) -> None:
    profile_id = _profile_id(client)
    assert client.patch(f"/api/profiles/{profile_id}", json={"name": "Renamed"}).status_code == 200
    assert client.delete(f"/api/profiles/{profile_id}").status_code == 204
    for event in ("profile_updated", "profile_deleted"):
        rows = [row for row in _rows(tenant.engine, event, "success") if profile_id in row.affected_resource]
        assert len(rows) == 1, event
        assert rows[0].workspace_id == tenant.workspace_id


def test_invitation_revocation_is_audited(tenant, client) -> None:
    created = client.post("/api/invitations", json={"email": "gone@example.test", "role": "viewer"})
    invitation = created.json()["invitation_id"]
    assert client.delete(f"/api/invitations/{invitation}").status_code == 204
    assert len(_rows(tenant.engine, "invitation_revoked", "success")) == 1


def test_audit_rows_are_append_only(tenant, client) -> None:
    _profile_create(client, tenant, None)
    for statement in (
        "UPDATE security_audit_record SET outcome = 'failure'",
        "DELETE FROM security_audit_record",
    ):
        db = app_session(tenant.engine)
        db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
                   {"w": str(tenant.workspace_id)})
        with pytest.raises(DBAPIError) as raised:
            db.execute(text(statement))
        assert raised.value.orig.sqlstate == "42501", statement
        db.rollback()
        db.close()


def test_audit_contains_no_secrets(tenant, client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "github_token", "ghp_" + uuid.uuid4().hex)
    monkeypatch.setattr(settings, "asgardeo_client_secret", "cs_" + uuid.uuid4().hex)

    invitation = client.post("/api/invitations", json={"email": "x@example.test", "role": "viewer"})
    invitation_token = invitation.json()["invitation_url"].split("token=", 1)[1]
    cookie = client.cookies.get(settings.session_cookie_name)
    # Workspace-bound events first, then the ones that end this session.
    for act in (
        _connect, _profile_create, _invite, _role_change, _switch, _scan_start,
        _scan_cancel, _finish_scans, _disconnect, _denied, _sign_out, _sign_in_failure,
        _sign_in_success,
    ):
        act(client, tenant, monkeypatch)

    secrets = [settings.github_token, settings.asgardeo_client_secret, invitation_token, cookie]
    with Session(tenant.engine) as db:
        assert db.scalar(text("SELECT count(*) FROM security_audit_record")) > 10
        for secret in filter(None, secrets):
            leaked = db.scalar(
                text(
                    "SELECT count(*) FROM security_audit_record a "
                    "WHERE a::text LIKE '%' || :s || '%'"
                ),
                {"s": secret},
            )
            assert leaked == 0, secret[:6]


def test_redaction_removes_credential_shaped_detail(tenant) -> None:
    from codesage_api.services import audit

    db = app_session(tenant.engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
               {"w": str(tenant.workspace_id)})
    audit.record(
        db, event_type="probe", outcome="success", workspace_id=tenant.workspace_id,
        detail={"access_token": "t1", "nested": {"Cookie": "c1", "ok": "kept"},
                "list": [{"client_secret": "s1"}], "password": "p1"},
    )
    db.commit()
    db.close()
    with Session(tenant.engine) as db:
        detail = db.scalar(
            select(SecurityAuditRecord.detail).where(SecurityAuditRecord.event_type == "probe")
        )
    assert detail == {
        "access_token": "[REDACTED]",
        "nested": {"Cookie": "[REDACTED]", "ok": "kept"},
        "list": [{"client_secret": "[REDACTED]"}],
        "password": "[REDACTED]",
    }


def test_audit_is_tenant_isolated(tenant, client) -> None:
    _profile_create(client, tenant, None)
    other = uuid.uuid4()
    with Session(tenant.engine) as db:
        db.add(Workspace(id=other, name="Other"))
        db.flush()
        db.add(SecurityAuditRecord(
            workspace_id=other, event_type="probe", outcome="success",
            actor_identity="x", affected_resource="workspace:other",
        ))
        db.add(SecurityAuditRecord(
            workspace_id=None, event_type="sign_in", outcome="failure",
            actor_identity="anonymous", affected_resource="session",
        ))
        db.commit()

    db = app_session(tenant.engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"),
               {"w": str(tenant.workspace_id)})
    visible = set(db.scalars(text("SELECT DISTINCT workspace_id FROM security_audit_record")))
    db.rollback()
    db.close()
    # Workspace A sees only its own rows: not B's, and not system-scope events.
    assert visible == {tenant.workspace_id}


def test_every_timestamp_column_uses_timezone_aware_postgresql_type(account) -> None:
    """DBR-26: instants must not silently depend on the database session timezone."""
    with Session(account[0]) as db:
        timestamp_columns = db.execute(
            text(
                "SELECT table_name, column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_schema='public' "
                "AND data_type LIKE 'timestamp%' ORDER BY table_name, column_name"
            )
        ).all()
    assert timestamp_columns
    assert {
        (table, column, data_type)
        for table, column, data_type in timestamp_columns
        if data_type != "timestamp with time zone"
    } == set()
