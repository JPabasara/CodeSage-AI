"""Onboarding: being signed in before having anywhere to work.

The state this file is about did not exist before — every session carried a
workspace because sign-in quietly made one. These tests pin the new shape: a real
authenticated session with no workspace, what it is allowed to reach, and what
creating the first workspace actually provisions.
"""

from __future__ import annotations

import uuid

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.models import (
    Membership,
    Repository,
    ScoringProfile,
    User,
    UserSession,
    Workspace,
    WorkspaceProfileSettings,
)
from codesage_api.main import create_app
from codesage_api.services.auth import IdentityClaims, establish_session

from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture


def _claims(email: str = "new@example.test") -> IdentityClaims:
    return IdentityClaims(
        sub=str(uuid.uuid4()),
        email=email,
        name="New User",
        picture=None,
        identity_provider="github",
        email_verified=True,
    )


@pytest.fixture
def onboarding(database):
    """A signed-in user who has no workspace at all."""
    config, _owner, engine = database
    command.upgrade(config, "head")
    claims = _claims()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        record = establish_session(db, claims)
        session_id, user_id = record.id, record.user_id
        db.commit()
    return engine, claims, user_id, session_id


@pytest.fixture
def client(onboarding, monkeypatch):
    engine, _claims_value, _user_id, session_id = onboarding

    def application_session():
        db = Session(engine)
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    monkeypatch.setattr("codesage_api.routers.auth.SessionLocal", application_session)
    monkeypatch.setattr("codesage_api.routers.members.SessionLocal", application_session)
    with TestClient(create_app()) as http:
        http.cookies.set(get_settings().session_cookie_name, str(session_id))
        yield http


# ── first sign-in ───────────────────────────────────────────────────────────


def test_first_sign_in_creates_a_person_and_nothing_else(onboarding):
    engine, _claims_value, _user_id, session_id = onboarding

    with Session(engine) as db:
        assert db.get(UserSession, session_id).workspace_id is None
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(Workspace)) == 0
        assert db.scalar(select(func.count()).select_from(Membership)) == 0
        assert db.scalar(select(func.count()).select_from(Repository)) == 0
        assert db.scalar(select(func.count()).select_from(ScoringProfile)) == 0


def test_the_session_reports_onboarding_rather_than_failing(client):
    response = client.get("/api/auth/session")

    assert response.status_code == 200
    body = response.json()
    assert body["workspace_id"] is None
    assert body["needs_workspace_setup"] is True
    assert body["role"] is None
    assert body["permissions"] == []
    assert body["email"] == "new@example.test"


def test_a_workspace_less_session_reaches_only_what_onboarding_needs(client):
    """Everything else is WORKSPACE_REQUIRED — never 401, which would loop."""
    assert client.get("/api/auth/session").status_code == 200
    assert client.get("/api/auth/workspaces").json() == []

    blocked = [
        ("GET", "/api/projects"),
        ("POST", "/api/projects"),
        ("GET", "/api/profiles"),
        ("GET", "/api/profiles/default"),
        ("GET", "/api/members"),
        ("GET", f"/api/repos/{uuid.uuid4()}/branches"),
    ]
    for method, path in blocked:
        response = client.request(method, path, json={"url": "https://github.com/a/b"})
        assert response.status_code == 409, (method, path, response.text)
        assert response.json()["code"] == "WORKSPACE_REQUIRED", (method, path)


# ── creating the first workspace ────────────────────────────────────────────


def test_creating_the_first_workspace_is_atomic_and_makes_the_creator_admin(
    client, onboarding
):
    engine, _claims_value, user_id, session_id = onboarding

    created = client.post(
        "/api/auth/workspaces",
        json={
            "name": "  Platform Team  ",
            "description": "  Everything platform  ",
            "website_url": "https://platform.example",
        },
    )

    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Platform Team"
    assert body["description"] == "Everything platform"
    assert body["website_url"] == "https://platform.example"
    assert body["role"] == "org-admin"
    assert body["is_active"] is True
    assert body["project_count"] == 0
    assert body["member_count"] == 1

    workspace_id = uuid.UUID(body["workspace_id"])
    with Session(engine) as db:
        # The session was switched server-side, not just in the response.
        assert db.get(UserSession, session_id).workspace_id == workspace_id
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        assert membership.role_id == "org-admin"
        assert membership.status.value == "active"
        # Built-ins and the Balanced default arrived in the same workflow.
        profiles = db.scalars(
            select(ScoringProfile).where(ScoringProfile.workspace_id == workspace_id)
        ).all()
        assert sorted(item.name for item in profiles) == [
            "Balanced",
            "Delivery-speed",
            "Security-first",
        ]
        settings = db.get(WorkspaceProfileSettings, workspace_id)
        default = next(item for item in profiles if item.id == settings.default_scoring_profile_id)
        assert default.name == "Balanced"
        # And no repository: a new workspace is genuinely empty.
        assert db.scalar(select(func.count()).select_from(Repository)) == 0


def test_onboarding_unlocks_the_rest_of_the_application(client):
    assert client.get("/api/projects").status_code == 409

    client.post("/api/auth/workspaces", json={"name": "Platform Team"})

    assert client.get("/api/projects").status_code == 200
    assert len(client.get("/api/profiles").json()) == 3
    session = client.get("/api/auth/session").json()
    assert session["needs_workspace_setup"] is False
    assert session["role"] == "org-admin"
    assert "project:read" in session["permissions"]


def test_workspace_metadata_is_validated_before_anything_is_created(client, onboarding):
    engine, *_rest = onboarding

    for body in (
        {"name": "   "},
        {"name": ""},
        {"name": "x" * 256},
        {"name": "Fine", "website_url": "not-a-url"},
        {"name": "Fine", "description": "x" * 1001},
    ):
        assert client.post("/api/auth/workspaces", json=body).status_code == 422, body

    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Workspace)) == 0


# ── metadata after onboarding ───────────────────────────────────────────────


def test_reading_and_updating_workspace_metadata(client):
    workspace_id = client.post(
        "/api/auth/workspaces", json={"name": "Platform Team"}
    ).json()["workspace_id"]

    read = client.get(f"/api/auth/workspaces/{workspace_id}")
    assert read.status_code == 200
    assert read.json()["description"] is None

    updated = client.patch(
        f"/api/auth/workspaces/{workspace_id}",
        json={"description": "Everything platform"},
    )
    assert updated.status_code == 200
    # A partial update leaves the name alone.
    assert updated.json()["name"] == "Platform Team"
    assert updated.json()["description"] == "Everything platform"

    cleared = client.patch(
        f"/api/auth/workspaces/{workspace_id}", json={"description": None}
    )
    assert cleared.json()["description"] is None
    assert cleared.json()["name"] == "Platform Team"


def test_another_workspace_is_not_readable_or_writable_through_this_session(client):
    client.post("/api/auth/workspaces", json={"name": "First"})
    second = client.post("/api/auth/workspaces", json={"name": "Second"}).json()
    # Creating the second switched to it, so the first is now the foreign one.
    first = next(
        item
        for item in client.get("/api/auth/workspaces").json()
        if item["workspace_id"] != second["workspace_id"]
    )

    assert client.get(f"/api/auth/workspaces/{first['workspace_id']}").status_code == 404
    assert (
        client.patch(
            f"/api/auth/workspaces/{first['workspace_id']}", json={"name": "Renamed"}
        ).status_code
        == 404
    )


def test_non_admins_cannot_create_or_update_a_workspace(client, onboarding):
    engine, _claims_value, user_id, _session_id = onboarding
    workspace_id = client.post(
        "/api/auth/workspaces", json={"name": "Platform Team"}
    ).json()["workspace_id"]

    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        membership.role_id = "developer"
        db.commit()

    assert client.post("/api/auth/workspaces", json={"name": "Another"}).status_code == 403
    assert (
        client.patch(
            f"/api/auth/workspaces/{workspace_id}", json={"name": "Renamed"}
        ).status_code
        == 403
    )


# ── switching, and roles that differ per workspace ──────────────────────────


def test_switching_changes_the_server_side_session_and_the_visible_data(
    client, onboarding
):
    engine, _claims_value, _user_id, session_id = onboarding
    first = client.post("/api/auth/workspaces", json={"name": "First"}).json()
    second = client.post("/api/auth/workspaces", json={"name": "Second"}).json()

    # Connect nothing; the counts alone prove which workspace is bound.
    switched = client.put(
        "/api/auth/workspaces/active", json={"workspace_id": first["workspace_id"]}
    )

    assert switched.status_code == 200
    assert switched.json()["workspace_id"] == first["workspace_id"]
    with Session(engine) as db:
        assert str(db.get(UserSession, session_id).workspace_id) == first["workspace_id"]
    listed = {item["workspace_id"]: item["is_active"] for item in client.get("/api/auth/workspaces").json()}
    assert listed[first["workspace_id"]] is True
    assert listed[second["workspace_id"]] is False


def test_a_user_can_hold_different_roles_in_different_workspaces(client, onboarding):
    engine, _claims_value, user_id, _session_id = onboarding
    first = client.post("/api/auth/workspaces", json={"name": "First"}).json()
    second = client.post("/api/auth/workspaces", json={"name": "Second"}).json()

    with Session(engine) as db:
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == user_id,
                Membership.workspace_id == uuid.UUID(first["workspace_id"]),
            )
        )
        membership.role_id = "viewer"
        db.commit()

    roles = {item["workspace_id"]: item["role"] for item in client.get("/api/auth/workspaces").json()}
    assert roles[first["workspace_id"]] == "viewer"
    assert roles[second["workspace_id"]] == "org-admin"

    client.put("/api/auth/workspaces/active", json={"workspace_id": first["workspace_id"]})
    assert client.get("/api/auth/session").json()["role"] == "viewer"
    assert client.post("/api/projects", json={"url": "https://github.com/a/b"}).status_code == 403


def test_returning_sign_in_lands_deterministically_in_the_last_workspace(
    client, onboarding
):
    engine, claims, _user_id, _session_id = onboarding
    first = client.post("/api/auth/workspaces", json={"name": "First"}).json()
    client.post("/api/auth/workspaces", json={"name": "Second"})
    client.put("/api/auth/workspaces/active", json={"workspace_id": first["workspace_id"]})

    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        returning = establish_session(db, claims)
        assert str(returning.workspace_id) == first["workspace_id"]
        db.commit()


# ── joining instead of creating ─────────────────────────────────────────────


def test_a_workspace_less_user_can_accept_an_invitation(client, onboarding):
    """The other way out of onboarding: be invited rather than create one.

    Acceptance has to work with no workspace bound, which is why it resolves the
    invitation through a SECURITY DEFINER function instead of an ordinary
    tenant-scoped read.
    """
    engine, _claims_value, user_id, _session_id = onboarding
    from codesage_api.services import member_admin
    from codesage_api.services.auth import create_workspace, establish_session

    # Somebody else's workspace, and an invitation to this user's verified email.
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        host = establish_session(db, _claims("host@example.test"))
        hosted = create_workspace(
            db, session_id=host.id, user_id=host.user_id, name="Host Team"
        )
        host_user_id, host_workspace_id = host.user_id, hosted.workspace_id
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        db.execute(
            text("SELECT set_config('app.current_workspace_id', :ws, true)"),
            {"ws": str(host_workspace_id)},
        )
        _invitation, token = member_admin.create_invitation(
            db,
            workspace_id=host_workspace_id,
            actor_user_id=host_user_id,
            email="new@example.test",
            role_id="developer",
            expires_in_hours=48,
        )
        db.commit()

    assert client.get("/api/auth/session").json()["needs_workspace_setup"] is True

    accepted = client.post("/api/invitations/accept", json={"token": token})

    assert accepted.status_code == 200
    assert accepted.json()["workspace_id"] == str(host_workspace_id)
    assert accepted.json()["role"] == "developer"

    # Acceptance creates a membership, never a second unrelated workspace.
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Workspace)) == 1
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        assert membership.workspace_id == host_workspace_id
        assert membership.role_id == "developer"

    # The session still has to be switched to it explicitly.
    switched = client.put(
        "/api/auth/workspaces/active", json={"workspace_id": str(host_workspace_id)}
    )
    assert switched.status_code == 200
    session = client.get("/api/auth/session").json()
    assert session["needs_workspace_setup"] is False
    assert session["role"] == "developer"
