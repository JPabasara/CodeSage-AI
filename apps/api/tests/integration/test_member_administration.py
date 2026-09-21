"""Invitation and member administration through the restricted application role."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import (
    Membership,
    SecurityAuditRecord,
    User,
    UserSession,
    Workspace,
    WorkspaceInvitation,
)
from codesage_api.errors import UpstreamUnavailable
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router
from codesage_api.routers import members as members_router

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414


@pytest.fixture
def admin_client(account, monkeypatch):
    engine, _, user_id, workspace_id, session_id = account

    def application_session():
        db = Session(engine)
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    monkeypatch.setattr(auth_router, "SessionLocal", application_session)
    monkeypatch.setattr(members_router, "SessionLocal", application_session)
    monkeypatch.setattr(members_router, "send_workspace_invitation", lambda **_kwargs: None)
    with TestClient(create_app()) as client:
        client.cookies.set(get_settings().session_cookie_name, str(session_id))
        yield client, engine, user_id, workspace_id


def test_unregistered_verified_user_accepts_single_use_invitation(admin_client):
    client, engine, _, target_workspace = admin_client
    invitation = client.post("/api/invitations", json={
        "email": "New.User@example.com", "role": "developer", "expires_in_hours": 24,
    })
    assert invitation.status_code == 201
    token = invitation.json()["invitation_url"].split("token=", 1)[1]

    invitee_id = uuid.uuid4()
    personal_workspace = uuid.uuid4()
    invitee_session = uuid.uuid4()
    with Session(engine) as db:
        db.add_all([
            User(id=invitee_id, asgardeo_sub=str(invitee_id), email="new.user@EXAMPLE.com",
                 email_verified=True),
            Workspace(id=personal_workspace),
        ])
        db.flush()
        db.add_all([
            Membership(user_id=invitee_id, workspace_id=personal_workspace,
                       role_id="org-admin", status=MembershipStatus.ACTIVE),
            UserSession(id=invitee_session, user_id=invitee_id, workspace_id=personal_workspace,
                        expires_at=datetime.now(UTC) + timedelta(hours=1)),
        ])
        db.commit()

    client.cookies.set(get_settings().session_cookie_name, str(invitee_session))
    accepted = client.post("/api/invitations/accept", json={"token": token})
    assert accepted.status_code == 200
    assert accepted.json()["workspace_id"] == str(target_workspace)
    assert accepted.json()["role"] == "developer"
    assert client.post("/api/invitations/accept", json={"token": token}).status_code == 404

    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(
            Membership.user_id == invitee_id, Membership.workspace_id == target_workspace
        ))
        assert (membership.status, membership.role_id) == (MembershipStatus.ACTIVE, "developer")
        events = db.scalars(select(SecurityAuditRecord.event_type).where(
            SecurityAuditRecord.workspace_id == target_workspace
        )).all()
        assert "invitation_created:success" in events
        assert "invitation_accepted:success" in events


def test_acceptance_requires_verified_matching_email(admin_client):
    client, engine, _, _ = admin_client
    created = client.post("/api/invitations", json={"email": "invitee@example.com", "role": "viewer"})
    token = created.json()["invitation_url"].split("token=", 1)[1]
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.asgardeo_sub.is_not(None)).order_by(User.id.desc()))
        user.email = "invitee@example.com"
        user.email_verified = False
        db.commit()
    assert client.post("/api/invitations/accept", json={"token": token}).status_code == 404


def test_delivery_failure_rolls_back_invitation(admin_client, monkeypatch):
    client, engine, _, workspace_id = admin_client

    def fail_delivery(**_kwargs):
        raise UpstreamUnavailable

    monkeypatch.setattr(members_router, "send_workspace_invitation", fail_delivery)
    response = client.post(
        "/api/invitations", json={"email": "undelivered@example.com", "role": "viewer"}
    )
    assert response.status_code == 503
    with Session(engine) as db:
        count = db.scalar(
            select(func.count()).select_from(WorkspaceInvitation).where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.email == "undelivered@example.com",
            )
        )
        assert count == 0


def test_last_active_org_admin_cannot_be_demoted_or_deactivated(admin_client):
    client, engine, admin_id, workspace_id = admin_client
    with Session(engine) as db:
        membership_id = db.scalar(select(Membership.id).where(
            Membership.user_id == admin_id, Membership.workspace_id == workspace_id
        ))
    assert client.patch(f"/api/members/{membership_id}/role", json={"role": "manager"}).status_code == 409
    assert client.delete(f"/api/members/{membership_id}").status_code == 409


def test_non_admin_can_list_but_cannot_manage_members(admin_client):
    client, engine, admin_id, workspace_id = admin_client
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(
            Membership.user_id == admin_id, Membership.workspace_id == workspace_id
        ))
        membership.role_id = "viewer"
        db.commit()
    assert client.get("/api/members").status_code == 200
    assert client.post("/api/invitations", json={"email": "x@example.com", "role": "viewer"}).status_code == 403
