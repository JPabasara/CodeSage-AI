from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api.deps import (
    get_current_user_id,
    get_db,
    get_workspace_id,
)
from codesage_api.errors import NotAuthenticated
from codesage_api.main import create_app
from codesage_api.schemas import RepoOut
from codesage_api.services import repositories as repository_service


def test_get_projects_returns_workspace_projects(
    monkeypatch,
) -> None:
    app = create_app()

    user_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    database_session = MagicMock(spec=Session)

    def override_current_user() -> uuid.UUID:
        return user_id

    def override_workspace() -> uuid.UUID:
        return workspace_id

    def override_database() -> Iterator[Session]:
        yield database_session

    def fake_list_projects(
        session: Session,
        requested_workspace_id: uuid.UUID,
    ) -> list[RepoOut]:
        assert session is database_session
        assert requested_workspace_id == workspace_id

        return [
            RepoOut(
                id=str(uuid.uuid4()),
                name="codesage",
                owner="group-16",
                visibility="public",
                url="https://github.com/group-16/codesage",
                default_branch="main",
                connected_at="2026-08-20T10:30:00+00:00",
                latest_health=None,
            )
        ]

    app.dependency_overrides[get_current_user_id] = override_current_user
    app.dependency_overrides[get_workspace_id] = override_workspace
    app.dependency_overrides[get_db] = override_database

    monkeypatch.setattr(
        repository_service,
        "list_projects",
        fake_list_projects,
    )

    with TestClient(app) as client:
        response = client.get("/api/projects")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": response.json()[0]["id"],
            "name": "codesage",
            "owner": "group-16",
            "visibility": "public",
            "url": "https://github.com/group-16/codesage",
            "default_branch": "main",
            "connected_at": "2026-08-20T10:30:00+00:00",
            "latest_health": None,
        }
    ]


def test_get_projects_requires_authentication() -> None:
    app = create_app()

    def reject_authentication() -> None:
        raise NotAuthenticated

    app.dependency_overrides[get_current_user_id] = reject_authentication

    with TestClient(app) as client:
        response = client.get("/api/projects")

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Sign in to continue.",
        "code": "NOT_AUTHENTICATED",
    }