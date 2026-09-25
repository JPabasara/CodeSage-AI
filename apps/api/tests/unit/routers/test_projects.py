from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.deps import (
    get_authorization_context,
    get_current_user_id,
    get_db,
    get_workspace_id,
)
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
    app.dependency_overrides[get_authorization_context] = lambda: AuthorizationContext(
        user_id=uuid.uuid4(), workspace_id=workspace_id, membership_id=uuid.uuid4(),
        role_id="org-admin", permissions=frozenset({
            "project:read", "repository:connect", "profile:read", "profile:update", "history:read"
        }),
    )

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


def _app_with_connect(monkeypatch, connect) -> TestClient:
    app = create_app()
    workspace_id = uuid.uuid4()
    db = MagicMock(spec=Session)

    def database() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_current_user_id] = uuid.uuid4
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_authorization_context] = lambda: AuthorizationContext(
        user_id=uuid.uuid4(), workspace_id=workspace_id, membership_id=uuid.uuid4(),
        role_id="org-admin", permissions=frozenset({"project:read", "repository:connect"}),
    )
    monkeypatch.setattr(repositories, "connect", connect)
    return TestClient(app)


def test_a_java_less_repository_is_a_400_listing_the_languages(monkeypatch) -> None:
    from codesage_api.errors import RepositoryHasNoJava

    def connect(*_args) -> RepoOut:
        raise RepositoryHasNoJava(["Python", "Shell"])

    with _app_with_connect(monkeypatch, connect) as client:
        response = client.post("/api/projects", json={"url": "https://github.com/a/b"})

    assert response.status_code == 400
    assert response.json() == {
        "detail": (
            "We couldn't find any Java in this repository. "
            "CodeSage reads Java for now; more languages are coming soon."
        ),
        "code": "REPOSITORY_HAS_NO_JAVA",
        "languages": ["Python", "Shell"],
    }


def test_an_oversized_repository_is_a_400_naming_the_limit(monkeypatch) -> None:
    from codesage_api.errors import RepositoryTooLarge

    def connect(*_args) -> RepoOut:
        raise RepositoryTooLarge(300)

    with _app_with_connect(monkeypatch, connect) as client:
        response = client.post("/api/projects", json={"url": "https://github.com/a/b"})

    assert response.status_code == 400
    # Exactly the contract's envelope: no `languages` on other codes.
    assert response.json() == {
        "detail": "This repository is larger than 300 MB, the most CodeSage can analyse today.",
        "code": "REPOSITORY_TOO_LARGE",
    }
