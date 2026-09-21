"""Workspace discovery and switching through the real restricted DB functions."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, User, UserSession, Workspace
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router

from .test_account_provisioning import account as account  # noqa: PLC0414 -- fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- fixture


@pytest.fixture
def workspace_set(account):
    engine, _, user_id, personal_workspace, session_id = account
    active_workspace = uuid.uuid4()
    invited_workspace = uuid.uuid4()
    inactive_workspace = uuid.uuid4()
    foreign_workspace = uuid.uuid4()
    foreign_user = uuid.uuid4()

    with Session(engine) as db:
        db.add_all(
            [
                Workspace(id=active_workspace),
                Workspace(id=invited_workspace),
                Workspace(id=inactive_workspace),
                Workspace(id=foreign_workspace),
                User(id=foreign_user, asgardeo_sub=str(foreign_user)),
            ]
        )
        db.flush()
        db.add_all(
            [
                Membership(
                    user_id=user_id,
                    workspace_id=active_workspace,
                    status=MembershipStatus.ACTIVE,
                    role_id="manager",
                ),
                Membership(
                    user_id=user_id,
                    workspace_id=invited_workspace,
                    status=MembershipStatus.INVITED,
                    role_id="developer",
                ),
                Membership(
                    user_id=user_id,
                    workspace_id=inactive_workspace,
                    status=MembershipStatus.INACTIVE,
                    role_id="org-admin",
                ),
                Membership(
                    user_id=foreign_user,
                    workspace_id=foreign_workspace,
                    status=MembershipStatus.ACTIVE,
                    role_id="org-admin",
                ),
            ]
        )
        db.commit()

    return {
        "engine": engine,
        "user": user_id,
        "session": session_id,
        "personal": personal_workspace,
        "active": active_workspace,
        "invited": invited_workspace,
        "inactive": inactive_workspace,
        "foreign": foreign_workspace,
        "foreign_user": foreign_user,
    }


@pytest.fixture
def client(workspace_set, monkeypatch):
    engine = workspace_set["engine"]

    def application_session():
        db = Session(engine)
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    monkeypatch.setattr(auth_router, "SessionLocal", application_session)
    with TestClient(create_app()) as http:
        http.cookies.set(get_settings().session_cookie_name, str(workspace_set["session"]))
        yield http


def test_lists_only_authenticated_users_active_workspaces(workspace_set, client):
    response = client.get("/api/auth/workspaces")

    assert response.status_code == 200
    assert {
        item["workspace_id"]: (item["role"], item["is_active"]) for item in response.json()
    } == {
        str(workspace_set["personal"]): ("org-admin", True),
        str(workspace_set["active"]): ("manager", False),
    }


def test_switch_updates_only_current_server_side_session(workspace_set, client):
    engine = workspace_set["engine"]
    second_session = UserSession(
        user_id=workspace_set["user"],
        workspace_id=workspace_set["personal"],
        expires_at=_future_expiry(engine, workspace_set["session"]),
    )
    with Session(engine) as db:
        db.add(second_session)
        db.commit()
        second_session_id = second_session.id

    response = client.put(
        "/api/auth/workspaces/active",
        json={"workspace_id": str(workspace_set["active"])},
    )

    assert response.status_code == 200
    assert response.json() == {
        "workspace_id": str(workspace_set["active"]),
        "role": "manager",
        "is_active": True,
    }
    with Session(engine) as db:
        assert db.get(UserSession, workspace_set["session"]).workspace_id == workspace_set["active"]
        assert db.get(UserSession, second_session_id).workspace_id == workspace_set["personal"]

    session_response = client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["workspace_id"] == str(workspace_set["active"])


@pytest.mark.parametrize("target", ["invited", "inactive", "foreign", "missing"])
def test_switch_rejects_non_active_or_foreign_workspace(workspace_set, client, target):
    workspace_id = uuid.uuid4() if target == "missing" else workspace_set[target]

    response = client.put("/api/auth/workspaces/active", json={"workspace_id": str(workspace_id)})

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found.", "code": "NOT_FOUND"}
    with Session(workspace_set["engine"]) as db:
        assert (
            db.get(UserSession, workspace_set["session"]).workspace_id == workspace_set["personal"]
        )


def test_discovery_function_requires_matching_session_and_user(workspace_set):
    engine = workspace_set["engine"]
    with engine.connect() as db:
        db.execute(text("SET ROLE codesage_app"))
        wrong_session = db.execute(
            text("SELECT * FROM app_active_workspaces_for_session(:session, :user)"),
            {"session": uuid.uuid4(), "user": workspace_set["user"]},
        ).all()
        wrong_user = db.execute(
            text("SELECT * FROM app_active_workspaces_for_session(:session, :user)"),
            {
                "session": workspace_set["session"],
                "user": workspace_set["foreign_user"],
            },
        ).all()

    assert wrong_session == []
    assert wrong_user == []


def test_switch_rechecks_membership_at_write_time(workspace_set, client):
    with Session(workspace_set["engine"]) as db:
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == workspace_set["user"],
                Membership.workspace_id == workspace_set["active"],
            )
        )
        membership.status = MembershipStatus.INACTIVE
        db.commit()

    response = client.put(
        "/api/auth/workspaces/active",
        json={"workspace_id": str(workspace_set["active"])},
    )

    assert response.status_code == 404


def test_restricted_functions_reject_expired_session(workspace_set):
    engine = workspace_set["engine"]
    with Session(engine) as db:
        session = db.get(UserSession, workspace_set["session"])
        session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    with engine.connect() as db:
        db.execute(text("SET ROLE codesage_app"))
        discovered = db.execute(
            text("SELECT * FROM app_active_workspaces_for_session(:session, :user)"),
            {"session": workspace_set["session"], "user": workspace_set["user"]},
        ).all()
        switched = db.scalar(
            text("SELECT app_switch_session_workspace(:session, :user, :workspace)"),
            {
                "session": workspace_set["session"],
                "user": workspace_set["user"],
                "workspace": workspace_set["active"],
            },
        )

    assert discovered == []
    assert switched is False


def _future_expiry(engine, session_id):
    with Session(engine) as db:
        return db.get(UserSession, session_id).expires_at
