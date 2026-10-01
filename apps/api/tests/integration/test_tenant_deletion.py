"""DBR-28: a workspace, or a person, can be removed completely and safely."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import (
    Membership,
    SecurityAuditRecord,
    User,
    UserSession,
    Workspace,
    WorkspaceInvitation,
)
from codesage_api.routers import members as members_router
from codesage_api.services.auth import IdentityClaims, establish_session

from .scans import (
    Issue,
    ScanWorld,
    Tenant,
    add_repository,
    api_client,
    app_session,
    queue_scan,
    run_scan,
)
from .scans import tenant as tenant  # noqa: PLC0414 -- pytest fixture
from .support import assert_no_orphans, token_hash
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture


def tenant_rows(engine, workspace_id: uuid.UUID) -> dict[str, set[str]]:
    """Every row the tenant can see, in every row-level-secured table."""
    db = app_session(engine)
    db.execute(text("SELECT set_config('app.current_workspace_id', :w, true)"), {"w": str(workspace_id)})
    tables = db.scalars(
        text(
            "SELECT relname FROM pg_class WHERE relrowsecurity "
            "AND relnamespace = 'public'::regnamespace ORDER BY relname"
        )
    ).all()
    rows = {table: set(db.scalars(text(f'SELECT t::text FROM "{table}" t'))) for table in tables}
    db.rollback()
    db.close()
    return rows


def surviving(engine, rows: dict[str, set[str]]) -> dict[str, int]:
    with Session(engine) as db:
        return {
            table: count
            for table, values in rows.items()
            if values and table != "security_audit_record"
            and (count := db.scalar(
                text(f'SELECT count(*) FROM "{table}" t WHERE t::text = ANY(:rows)'),
                {"rows": list(values)},
            ))
        }


def second_tenant(tenant: Tenant, monkeypatch) -> Tenant:
    """Workspace B: its own admin, repository and completed scan."""
    claims = IdentityClaims(str(uuid.uuid4()), "b@example.test", "B", None, "github")
    db = app_session(tenant.engine)
    record = establish_session(db, claims)
    workspace_id = record.workspace_id
    db.get_one(Workspace, workspace_id).name = "Beta"
    db.commit()
    db.close()
    repository_id, branch_id = add_repository(tenant.engine, workspace_id, "beta-app")
    other = Tenant(
        tenant.engine, record.user_id, workspace_id, record.id,
        repository_id, branch_id, ScanWorld(issues=[Issue("src/B.java", "b")]),
    )
    # The outside-world stubs read the *current* world; point them at B briefly.
    tenant.world.issues, saved = other.world.issues, tenant.world.issues
    run_scan(other, "b" * 40)
    tenant.world.issues = saved
    return other


def populate(tenant: Tenant, client) -> None:
    """Everything a working workspace accumulates."""
    tenant.world.issues = [Issue("src/App.java", "alpha"), Issue("src/Util.java", "beta")]
    run_scan(tenant, "1" * 40)
    run_scan(tenant, "2" * 40)
    client.get(f"/api/repos/{tenant.repository_id}/health", params={"branch": "main"})
    profile = client.post("/api/profiles", json={
        "name": "Strict",
        "weights": {"security": 3, "code_design": 1, "requirement": 1, "documentation": 1, "test": 1},
        "trust_s": 0.5,
    })
    assert profile.status_code == 201, profile.text
    assigned = client.put(
        f"/api/projects/{tenant.repository_id}/profile",
        json={"profile_id": profile.json()["id"]},
    )
    assert assigned.status_code == 200, assigned.text
    invited = client.post("/api/invitations", json={"email": "c@example.test", "role": "viewer"})
    assert invited.status_code == 201, invited.text
    with Session(tenant.engine) as db:
        member = User(asgardeo_sub=str(uuid.uuid4()), email="member@example.test")
        db.add(member)
        db.flush()
        db.add(Membership(user_id=member.id, workspace_id=tenant.workspace_id,
                          status=MembershipStatus.ACTIVE, role_id="developer"))
        db.add(UserSession(user_id=member.id, workspace_id=tenant.workspace_id,
                           token_hash=token_hash(uuid.uuid4().hex),
                           expires_at=datetime.now(UTC) + timedelta(hours=1)))
        db.commit()


@pytest.fixture
def client(tenant, monkeypatch):
    monkeypatch.setattr(members_router, "send_workspace_invitation", lambda **_kwargs: None)
    return api_client(tenant.engine, tenant.session_id, monkeypatch)


def _delete(client, workspace_id, name="Acme"):
    return client.request(
        "DELETE", f"/api/auth/workspaces/{workspace_id}", json={"confirmation_name": name}
    )


def test_workspace_deletion_removes_every_tenant_row(tenant, client, monkeypatch) -> None:
    populate(tenant, client)
    other = second_tenant(tenant, monkeypatch)
    doomed = tenant_rows(tenant.engine, tenant.workspace_id)
    kept = tenant_rows(tenant.engine, other.workspace_id)
    # The seed really covers the tenant: every kind of tenant data is present.
    for table in ("repository", "branch", "analysis_attempt", "snapshot", "source_file",
                  "finding", "snapshot_score", "scoring_profile", "workspace_invitation",
                  "membership", "repository_profile_assignment", "security_audit_record"):
        assert doomed[table], table

    with Session(tenant.engine) as db:
        bound = set(db.scalars(
            select(UserSession.id).where(UserSession.workspace_id == tenant.workspace_id)
        ))
    assert len(bound) == 2  # the deleter's and the other member's

    response = _delete(client, tenant.workspace_id)

    assert response.status_code == 204, response.text
    assert "set-cookie" not in response.headers
    assert surviving(tenant.engine, doomed) == {}
    assert tenant_rows(tenant.engine, other.workspace_id) == kept
    with Session(tenant.engine) as db:
        assert_no_orphans(db.connection())
        assert db.get(Workspace, tenant.workspace_id) is None
        # Nobody is signed out: every bound session drops to no workspace.
        kept_sessions = db.execute(
            select(UserSession.id, UserSession.workspace_id).where(UserSession.id.in_(bound))
        ).all()
        assert {row.id for row in kept_sessions} == bound
        assert {row.workspace_id for row in kept_sessions} == {None}
        # Audit history survives the tenant, detached but still attributable.
        kept_audit = db.scalars(
            select(SecurityAuditRecord).where(SecurityAuditRecord.workspace_name == "Acme")
        ).all()
        assert [row.event_type for row in kept_audit] == ["workspace_deleted"]
        assert kept_audit[0].workspace_id is None
        assert kept_audit[0].actor_identity == str(tenant.user_id)
        orphaned = db.scalar(
            text("SELECT count(*) FROM security_audit_record WHERE workspace_id IS NULL")
        )
        assert orphaned >= len(doomed["security_audit_record"])
    # The deleter is still signed in, now in the no-workspace state.
    session = client.get("/api/auth/session")
    assert session.status_code == 200, session.text
    assert session.json()["workspace_id"] is None
    assert session.json()["needs_workspace_setup"] is True
    assert client.get("/api/projects").json()["code"] == "WORKSPACE_REQUIRED"


def test_workspace_deletion_blocked_while_scan_active(tenant, client) -> None:
    queue_scan(tenant, "3" * 40)
    response = _delete(client, tenant.workspace_id)
    assert response.status_code == 409
    assert response.json()["code"] == "WORKSPACE_SCAN_RUNNING"
    with Session(tenant.engine) as db:
        assert db.get(Workspace, tenant.workspace_id) is not None


def test_workspace_deletion_requires_the_exact_name(tenant, client) -> None:
    for wrong in ("acme", "Acme ", "Other"):
        response = _delete(client, tenant.workspace_id, wrong)
        assert response.status_code == 409
        assert response.json()["code"] == "WORKSPACE_CONFIRMATION_MISMATCH"
    with Session(tenant.engine) as db:
        assert db.get(Workspace, tenant.workspace_id) is not None


@pytest.mark.parametrize("role", ["manager", "developer", "viewer"])
def test_non_admin_cannot_delete_workspace(tenant, client, role) -> None:
    with Session(tenant.engine) as db:
        db.execute(text("UPDATE membership SET role_id = :r WHERE user_id = :u"),
                   {"r": role, "u": tenant.user_id})
        db.commit()
    response = _delete(client, tenant.workspace_id)
    assert response.status_code == 403
    with Session(tenant.engine) as db:
        assert db.get(Workspace, tenant.workspace_id) is not None
        assert db.scalar(select(SecurityAuditRecord).where(
            SecurityAuditRecord.event_type == "operation_denied",
            SecurityAuditRecord.outcome == "denied",
        )) is not None


def test_foreign_workspace_delete_is_404(tenant, client, monkeypatch) -> None:
    other = second_tenant(tenant, monkeypatch)
    before = tenant_rows(tenant.engine, other.workspace_id)
    for target in (other.workspace_id, uuid.uuid4()):
        assert _delete(client, target, "Beta").status_code == 404
    assert tenant_rows(tenant.engine, other.workspace_id) == before


def test_other_workspace_untouched(tenant, client, monkeypatch) -> None:
    other = second_tenant(tenant, monkeypatch)
    with Session(tenant.engine) as db:
        counts = {
            table: db.scalar(text(f'SELECT count(*) FROM "{table}"'))
            for table in ("app_user",)
        }
    before = tenant_rows(tenant.engine, other.workspace_id)
    assert _delete(client, tenant.workspace_id).status_code == 204
    assert tenant_rows(tenant.engine, other.workspace_id) == before
    other_client = api_client(tenant.engine, other.session_id, monkeypatch)
    assert other_client.get("/api/projects").status_code == 200
    with Session(tenant.engine) as db:
        # People are not tenant data; both users still exist.
        assert db.scalar(text("SELECT count(*) FROM app_user")) == counts["app_user"]


def test_user_deletion_anonymizes_and_keeps_workspace_data(tenant, client, monkeypatch) -> None:
    tenant.world.issues = [Issue("src/App.java", "alpha")]
    with Session(tenant.engine) as db:
        member = User(asgardeo_sub="asgardeo|leaver", email="leaver@example.test",
                      display_name="Leaver", avatar_url="https://a.example/l.png",
                      identity_provider="github", github_user_id=None)
        db.add(member)
        db.flush()
        member_id = member.id
        db.add(Membership(user_id=member_id, workspace_id=tenant.workspace_id,
                          status=MembershipStatus.ACTIVE, role_id="org-admin"))
        session = UserSession(user_id=member_id, workspace_id=tenant.workspace_id,
                              token_hash=token_hash(uuid.uuid4().hex),
                              expires_at=datetime.now(UTC) + timedelta(hours=1))
        db.add(session)
        db.add(WorkspaceInvitation(workspace_id=tenant.workspace_id, email="x@example.test",
                                   role_id="viewer", token_hash=token_hash(uuid.uuid4().hex),
                                   invited_by_user_id=member_id,
                                   expires_at=datetime.now(UTC) + timedelta(days=1)))
        db.commit()
        session_id = session.id
    leaver = tenant.__class__(**{**tenant.__dict__, "user_id": member_id, "session_id": session_id})
    attempt = run_scan(leaver, "4" * 40)
    leaver_client = api_client(tenant.engine, session_id, monkeypatch)
    assert leaver_client.post("/api/invitations",
                              json={"email": "y@example.test", "role": "viewer"}).status_code == 201
    workspace_before = tenant_rows(tenant.engine, tenant.workspace_id)

    response = leaver_client.delete("/api/auth/me")

    assert response.status_code == 204, response.text
    assert "Max-Age=0" in response.headers["set-cookie"]
    with Session(tenant.engine) as db:
        user = db.get(User, member_id)
        assert (user.email, user.display_name, user.avatar_url, user.identity_provider,
                user.github_user_id, user.github_username) == (None,) * 6
        assert user.asgardeo_sub == f"deleted:{member_id}"
        assert db.scalar(select(Membership).where(Membership.user_id == member_id)) is None
        assert db.scalar(select(UserSession).where(UserSession.user_id == member_id)) is None
        assert db.scalar(
            select(SecurityAuditRecord).where(SecurityAuditRecord.actor_identity == str(member_id))
        ) is None
        assert db.scalar(text(
            "SELECT count(*) FROM security_audit_record WHERE actor_identity = 'deleted-user'"
        )) == 1  # the invitation they sent
        # Shared workspace facts stay: the scan they ran, the invitation they sent.
        assert db.scalar(text("SELECT count(*) FROM snapshot s WHERE s.analysis_attempt_id = :a"),
                         {"a": attempt}) == 1
        assert db.scalar(text(
            "SELECT count(*) FROM workspace_invitation WHERE invited_by_user_id IS NULL"
        )) == 0  # the user row still exists, anonymized, so the link is kept
        assert_no_orphans(db.connection())
    after = tenant_rows(tenant.engine, tenant.workspace_id)
    for table in ("repository", "snapshot", "finding", "workspace_invitation", "scoring_profile"):
        assert after[table] == workspace_before[table], table
    assert leaver_client.get("/api/auth/session").status_code == 401


def test_hard_deleted_inviter_leaves_invitation_with_null_inviter(tenant) -> None:
    """invited_by_user_id is ON DELETE SET NULL, so a user row can be erased."""
    with Session(tenant.engine) as db:
        inviter = User(asgardeo_sub=str(uuid.uuid4()))
        db.add(inviter)
        db.flush()
        invitation = WorkspaceInvitation(
            workspace_id=tenant.workspace_id, email="z@example.test", role_id="viewer",
            token_hash=token_hash(uuid.uuid4().hex), invited_by_user_id=inviter.id,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        db.add(invitation)
        db.commit()
        db.delete(inviter)
        db.commit()
        db.refresh(invitation)
        assert invitation.invited_by_user_id is None


def test_last_admin_cannot_delete_account(tenant, client) -> None:
    response = client.delete("/api/auth/me")
    assert response.status_code == 409
    assert response.json()["code"] == "LAST_WORKSPACE_ADMIN"
    with Session(tenant.engine) as db:
        user = db.get(User, tenant.user_id)
        assert user.email == "user@example.test"
        assert db.scalar(select(Membership).where(Membership.user_id == tenant.user_id)) is not None
    assert client.get("/api/auth/session").status_code == 200


def test_inactive_admin_membership_does_not_count_as_another_admin(tenant, client) -> None:
    with Session(tenant.engine) as db:
        other = User(asgardeo_sub=str(uuid.uuid4()))
        db.add(other)
        db.flush()
        db.add(Membership(user_id=other.id, workspace_id=tenant.workspace_id,
                          status=MembershipStatus.INACTIVE, role_id="org-admin"))
        db.commit()
    assert client.delete("/api/auth/me").status_code == 409


def test_workspace_deletion_does_not_pick_another_workspace(tenant, client, monkeypatch) -> None:
    """Deletion always ends in the no-workspace state, even for a user who has
    another workspace to go to; choosing one is left to them."""
    other = second_tenant(tenant, monkeypatch)
    with Session(tenant.engine) as db:
        db.add(Membership(user_id=tenant.user_id, workspace_id=other.workspace_id,
                          status=MembershipStatus.ACTIVE, role_id="viewer"))
        db.commit()

    assert _delete(client, tenant.workspace_id).status_code == 204

    session = client.get("/api/auth/session").json()
    assert session["workspace_id"] is None
    assert session["needs_workspace_setup"] is True
    workspaces = client.get("/api/auth/workspaces").json()
    assert [(w["workspace_id"], w["is_active"]) for w in workspaces] == [
        (str(other.workspace_id), False)
    ]
    switched = client.put("/api/auth/workspaces/active",
                          json={"workspace_id": str(other.workspace_id)})
    assert switched.status_code == 200, switched.text
