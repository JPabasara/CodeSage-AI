"""Account provisioning and membership status under the application database role."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, User, UserSession, Workspace
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import NotFound
from codesage_api.services.auth import (
    IdentityClaims,
    create_workspace,
    establish_session,
    load_valid_session,
)
from codesage_api.services.memberships import (
    accept_workspace_invitation,
    get_workspace_permissions,
)

from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture


@pytest.fixture
def account(database):
    """A signed-in user who has completed onboarding.

    Two steps now, because sign-in no longer invents a workspace: establish the
    session, then create one the way the onboarding screen does. Everything
    downstream of this fixture assumes a user who is already working.
    """
    config, _, engine = database
    command.upgrade(config, "head")
    claims = IdentityClaims(str(uuid.uuid4()), "user@example.test", "User", None, "github")
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        record = establish_session(db, claims)
        assert record.workspace_id is None, "a first sign-in must not create a workspace"
        created = create_workspace(
            db, session_id=record.id, user_id=record.user_id, name="Acme"
        )
        assert created is not None
        ids = (record.user_id, created.workspace_id, record.id)
        db.commit()
    return engine, claims, *ids


@pytest.mark.parametrize("role", ["org-admin", "manager", "developer", "viewer"])
def test_returning_signin_preserves_role_and_workspace(account, role):
    engine, claims, user_id, workspace_id, _ = account
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        membership.role_id = role
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        record = establish_session(db, claims)
        assert record.workspace_id == workspace_id
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        assert membership.role_id == role
        assert membership.status == MembershipStatus.ACTIVE
        db.commit()
    with Session(engine) as db:
        assert len(db.scalars(select(Workspace)).all()) == 1
        assert len(db.scalars(select(User)).all()) == 1


@pytest.mark.parametrize("status", ["invited", "inactive", "removed"])
def test_nonactive_membership_revokes_existing_session_and_blocks_signin(account, status):
    engine, claims, user_id, workspace_id, session_id = account
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        if status == "removed":
            db.delete(membership)
        else:
            membership.status = MembershipStatus(status)
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        set_workspace_context(db, workspace_id)
        assert get_workspace_permissions(db, user_id, workspace_id) == frozenset()
        assert load_valid_session(db, str(session_id)) is None
        db.commit()
    with Session(engine) as db:
        assert db.get(UserSession, session_id) is None
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        # Signing in again succeeds, but lands nowhere. Losing your last
        # membership is not the same as not being a user: identity is the
        # Asgardeo subject, and it is still valid. What they lose is every
        # workspace, so the new session has none and every workspace-bound
        # endpoint answers WORKSPACE_REQUIRED until someone invites them back.
        revoked = establish_session(db, claims)
        assert revoked.user_id == user_id
        assert revoked.workspace_id is None
        db.rollback()


@pytest.mark.parametrize("role", ["org-admin", "manager", "developer", "viewer"])
def test_acceptance_preserves_invitation_role(account, role):
    engine, _, user_id, personal_workspace, _ = account
    invited_workspace = uuid.uuid4()
    with Session(engine) as db:
        db.add(Workspace(id=invited_workspace))
        db.flush()
        db.add(
            Membership(
                user_id=user_id,
                workspace_id=invited_workspace,
                status=MembershipStatus.INVITED,
                role_id=role,
            )
        )
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        set_workspace_context(db, invited_workspace)
        assert not get_workspace_permissions(db, user_id, invited_workspace)
        membership = accept_workspace_invitation(db, user_id, invited_workspace)
        assert membership.role_id == role
        assert membership.status == MembershipStatus.ACTIVE
        assert "project:read" in get_workspace_permissions(db, user_id, invited_workspace)
        assert not get_workspace_permissions(db, user_id, personal_workspace)
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        with pytest.raises(NotFound):
            accept_workspace_invitation(db, user_id, invited_workspace)
        db.rollback()


@pytest.mark.parametrize("target", ["another_user", "inactive", "missing"])
def test_acceptance_cannot_claim_other_users_or_reactivate_memberships(account, target):
    engine, _, user_id, _, _ = account
    workspace_id = uuid.uuid4()
    with Session(engine) as db:
        db.add(Workspace(id=workspace_id))
        db.flush()
        target_user = user_id
        if target == "another_user":
            user = User(asgardeo_sub=str(uuid.uuid4()))
            db.add(user)
            db.flush()
            target_user = user.id
        if target != "missing":
            db.add(
                Membership(
                    user_id=target_user,
                    workspace_id=workspace_id,
                    status=MembershipStatus.INACTIVE
                    if target == "inactive"
                    else MembershipStatus.INVITED,
                    role_id="org-admin",
                )
            )
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        with pytest.raises(NotFound):
            accept_workspace_invitation(db, user_id, workspace_id)
        assert not get_workspace_permissions(db, user_id, workspace_id)
        db.rollback()


def test_active_membership_in_other_workspace_does_not_validate_session(account):
    engine, _, user_id, _, _ = account
    workspace_id, session_id = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(UTC)
    with Session(engine) as db:
        db.add(Workspace(id=workspace_id))
        db.flush()
        db.add(
            UserSession(
                id=session_id,
                user_id=user_id,
                workspace_id=workspace_id,
                created_at=now,
                last_used_at=now,
                expires_at=now + timedelta(minutes=30),
            )
        )
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        assert load_valid_session(db, str(session_id)) is None
        db.commit()


def test_role_change_applies_to_existing_session(account):
    engine, _, user_id, workspace_id, session_id = account
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        membership.role_id = "viewer"
        db.commit()
    with Session(engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        assert load_valid_session(db, str(session_id)) is not None
        permissions = get_workspace_permissions(db, user_id, workspace_id)
        assert "project:read" in permissions
        assert "member:manage" not in permissions
        db.commit()


@pytest.mark.parametrize("status", ["invited", "inactive"])
def test_protected_endpoint_rejects_nonactive_membership(account, monkeypatch, status):
    from fastapi.testclient import TestClient

    from codesage_api import deps
    from codesage_api.config import get_settings
    from codesage_api.main import create_app

    engine, _, user_id, _, session_id = account
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        membership.status = MembershipStatus(status)
        db.commit()

    def application_session():
        db = Session(engine)
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    with TestClient(create_app()) as client:
        client.cookies.set(get_settings().session_cookie_name, str(session_id))
        response = client.get("/api/auth/session")
    assert response.status_code == 401
    with Session(engine) as db:
        assert db.get(UserSession, session_id) is None
