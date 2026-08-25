from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.main import create_app
from codesage_api.schemas import RepoOut
from codesage_api.services import repositories


def test_connect_project_passes_authenticated_context(monkeypatch) -> None:
    app = create_app()
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db = MagicMock(spec=Session)

    def database() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_current_user_id] = lambda: user_id
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_db] = database

    expected = RepoOut(
        id=str(uuid.uuid4()),
        name="CodeSage-AI",
        owner="JPabasara",
        visibility="public",
        url="https://github.com/JPabasara/CodeSage-AI",
        default_branch="main",
        connected_at="2026-08-25T00:00:00+00:00",
        latest_health=None,
    )

    def connect(
        session: Session,
        requested_workspace: uuid.UUID,
        url: str,
        actor: uuid.UUID,
    ) -> RepoOut:
        assert session is db
        assert requested_workspace == workspace_id
        assert actor == user_id
        assert url == "https://github.com/JPabasara/CodeSage-AI"
        return expected

    monkeypatch.setattr(repositories, "connect", connect)
    with TestClient(app) as client:
        response = client.post(
            "/api/projects",
            json={"url": "https://github.com/JPabasara/CodeSage-AI"},
        )

    assert response.status_code == 201
    assert response.json()["default_branch"] == "main"
