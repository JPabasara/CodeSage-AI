from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.authorization.context import AuthorizationContext
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.deps import (
    get_authorization_context,
    get_current_user_id,
    get_db,
    get_workspace_id,
)
from codesage_api.main import create_app
from codesage_api.services import finding_triage

TRIAGER = frozenset({"result:read", "finding:triage"})
VIEWER = frozenset({"result:read"})


def _client(
    monkeypatch: pytest.MonkeyPatch,
    permissions: frozenset[str],
    *,
    snapshot_visible: bool = True,
) -> tuple[TestClient, MagicMock, uuid.UUID, uuid.UUID]:
    app = create_app()
    db = MagicMock(spec=Session)
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    def database() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_current_user_id] = lambda: user_id
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_authorization_context] = lambda: AuthorizationContext(
        user_id=user_id, workspace_id=workspace_id, membership_id=uuid.uuid4(),
        role_id="developer", permissions=permissions,
    )
    monkeypatch.setattr(
        dashboard_repository,
        "find_done_snapshot",
        MagicMock(return_value=object() if snapshot_visible else None),
    )
    # The 403 handler audits in its own session; keep it off the real database.
    monkeypatch.setattr(deps, "SessionLocal", MagicMock())
    return TestClient(app), db, workspace_id, user_id


def _url(snapshot_id: uuid.UUID, fingerprint: str = "abc123") -> str:
    return f"/api/snapshots/{snapshot_id}/findings/{fingerprint}/status"


def test_mark_as_done_passes_authenticated_context(monkeypatch) -> None:
    client, db, workspace_id, user_id = _client(monkeypatch, TRIAGER)
    set_status = MagicMock()
    monkeypatch.setattr(finding_triage, "set_status", set_status)
    snapshot_id = uuid.uuid4()

    with client:
        response = client.put(_url(snapshot_id), json={"status": "done"})

    assert response.status_code == 204
    assert response.content == b""
    set_status.assert_called_once_with(
        db,
        workspace_id=workspace_id,
        snapshot_id=snapshot_id,
        fingerprint="abc123",
        status="done",
        actor_user_id=user_id,
    )


def test_triage_needs_the_triage_permission(monkeypatch) -> None:
    client, _db, _workspace_id, _user_id = _client(monkeypatch, VIEWER)
    set_status = MagicMock(side_effect=AssertionError("reached the service"))
    monkeypatch.setattr(finding_triage, "set_status", set_status)

    with client:
        response = client.put(_url(uuid.uuid4()), json={"status": "done"})

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    set_status.assert_not_called()


def test_another_workspaces_snapshot_is_not_found_before_permission(monkeypatch) -> None:
    """A viewer must not learn that another tenant's snapshot id exists."""
    client, _db, _workspace_id, _user_id = _client(
        monkeypatch, VIEWER, snapshot_visible=False
    )

    with client:
        response = client.put(_url(uuid.uuid4()), json={"status": "done"})

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_unsupported_status_is_a_validation_failure(monkeypatch) -> None:
    client, db, _workspace_id, _user_id = _client(monkeypatch, TRIAGER)

    with client:
        response = client.put(_url(uuid.uuid4()), json={"status": "false-positive"})

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Status must be open or done.",
        "code": "VALIDATION_FAILED",
    }
    db.execute.assert_not_called()


def test_overlong_fingerprint_is_rejected(monkeypatch) -> None:
    client, _db, _workspace_id, _user_id = _client(monkeypatch, TRIAGER)

    with client:
        response = client.put(_url(uuid.uuid4(), "f" * 129), json={"status": "done"})

    assert response.status_code == 422
