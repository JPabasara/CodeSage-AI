"""Exercise real dependency chains and RLS with the non-owner application role."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.authorization.context import AuthorizationContext
from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, RolePermission, UserSession, Workspace
from codesage_api.main import create_app

from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

POLICY = json.loads(
    (Path(__file__).resolve().parents[2] / "src/codesage_api/authorization/policy.json").read_text()
)


@pytest.fixture
def client(account, monkeypatch):
    engine, _, _, _, session_id = account

    def application_session():
        db = Session(engine)
        db.execute(text("SET LOCAL ROLE codesage_app"))
        return db

    monkeypatch.setattr(deps, "SessionLocal", application_session)
    app = create_app()
    app.state.executed = []

    def protected_action():
        app.state.executed.append(True)
        return {"ok": True}

    for permission in [*POLICY["permissions"], "unknown:permission"]:
        app.add_api_route(
            f"/test/permission/{permission}",
            protected_action,
            methods=["POST"],
            dependencies=[Depends(deps.require_permission(permission))],
        )

    @app.get("/test/context")
    def context_info(
        context: Annotated[AuthorizationContext, Depends(deps.get_authorization_context)],
        checked: Annotated[AuthorizationContext, Depends(deps.require_permission("project:read"))],
    ):
        assert context is checked
        return {
            "user_id": str(context.user_id),
            "workspace_id": str(context.workspace_id),
            "membership_id": str(context.membership_id),
            "role_id": context.role_id,
            "permissions": sorted(context.permissions),
        }

    @app.get("/test/resource/{resource_id}")
    def resource_info(
        resource_id: uuid.UUID,
        db: Annotated[Session, Depends(deps.get_db)],
        context: Annotated[AuthorizationContext, Depends(deps.get_authorization_context)],
    ):
        workspace = db.get(Workspace, resource_id)
        context.require_resource(
            workspace, resource_workspace_id=workspace.id if workspace else None
        )
        context.require_permission("workspace:update")
        return {"ok": True}

    with TestClient(app) as http:
        http.cookies.set(get_settings().session_cookie_name, str(session_id))
        yield http


def set_role(account, role):
    engine, _, user_id, _, _ = account
    with Session(engine) as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
        membership.role_id = role
        db.commit()
        return membership.id


@pytest.mark.parametrize("role", list(POLICY["roles"]))
def test_matrix_and_context(account, client, role):
    membership_id = set_role(account, role)
    for permission in POLICY["permissions"]:
        before = len(client.app.state.executed)
        response = client.post(f"/test/permission/{permission}")
        allowed = permission in POLICY["roles"][role]
        assert response.status_code == (200 if allowed else 403)
        assert len(client.app.state.executed) == before + int(allowed)
        if not allowed:
            assert response.json()["code"] == "FORBIDDEN"
    context = client.get("/test/context")
    assert context.status_code == 200
    assert context.json() == {
        "user_id": str(account[2]),
        "workspace_id": str(account[3]),
        "membership_id": str(membership_id),
        "role_id": role,
        "permissions": sorted(POLICY["roles"][role]),
    }
    assert client.post("/test/permission/unknown:permission").status_code == 403


def test_next_request_uses_new_role_without_signin(account, client):
    assert client.post("/test/permission/scan:start").status_code == 200
    set_role(account, "viewer")
    assert client.post("/test/permission/scan:start").status_code == 403
    set_role(account, "developer")
    assert client.post("/test/permission/scan:start").status_code == 200


@pytest.mark.parametrize("status", ["invited", "inactive", "removed"])
def test_membership_revocation_on_next_request(account, client, status):
    assert client.get("/test/context").status_code == 200
    with Session(account[0]) as db:
        member = db.scalar(select(Membership).where(Membership.user_id == account[2]))
        if status == "removed":
            db.delete(member)
        else:
            member.status = MembershipStatus(status)
        db.commit()
    response = client.get("/test/context")
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


@pytest.mark.parametrize("cookie", [None, "invalid", str(uuid.uuid4()), "expired"])
def test_invalid_authentication_is_401(account, client, cookie):
    client.cookies.clear()
    if cookie == "expired":
        with Session(account[0]) as db:
            record = db.get(UserSession, account[4])
            record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.commit()
        cookie = str(account[4])
    if cookie is not None:
        client.cookies.set(get_settings().session_cookie_name, cookie)
    response = client.post("/test/permission/scan:start")
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"
    assert not client.app.state.executed


def test_missing_and_foreign_resources_have_identical_404(account, client):
    foreign_workspace = uuid.uuid4()
    with Session(account[0]) as db:
        db.add(Workspace(id=foreign_workspace))
        db.commit()
    set_role(account, "viewer")
    missing = client.get(f"/test/resource/{uuid.uuid4()}")
    foreign = client.get(f"/test/resource/{foreign_workspace}")
    assert missing.status_code == foreign.status_code == 404
    assert missing.json() == foreign.json() == {"detail": "Not found.", "code": "NOT_FOUND"}
    assert client.get(f"/test/resource/{account[3]}").status_code == 403
    set_role(account, "org-admin")
    assert client.get(f"/test/resource/{account[3]}").status_code == 200


def test_role_with_no_grants_is_authenticated_but_forbidden(account, client):
    set_role(account, "viewer")
    with Session(account[0]) as db:
        db.execute(delete(RolePermission).where(RolePermission.role_id == "viewer"))
        db.commit()
    assert client.post("/test/permission/project:read").status_code == 403
