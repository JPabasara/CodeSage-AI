"""GET /api/auth/session — who is signed in (J3.2).

The dependency chain (`get_current_user_id` -> `get_workspace_id` -> `get_db`) is
already the app's one path to a valid tenant and is exercised elsewhere; overriding
it here lets this file test only what this handler itself is responsible for:
shaping a `Session` from the user row.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi.testclient import TestClient

from codesage_api import deps
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router

USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
WORKSPACE_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


@dataclass
class FakeUser:
    id: uuid.UUID
    email: str | None
    display_name: str | None
    avatar_url: str | None
    identity_provider: str | None


class FakeDb:
    """Stands in for the request-scoped SQLAlchemy session `get_db` would yield."""

    def __init__(self, user: FakeUser) -> None:
        self._user = user

    def get_one(self, _model: object, ident: uuid.UUID) -> FakeUser:
        assert ident == self._user.id, "must look up the caller's own row, not an arbitrary one"
        return self._user


def _client(user: FakeUser) -> TestClient:
    app = create_app()
    app.dependency_overrides[deps.get_current_user_id] = lambda: user.id
    app.dependency_overrides[deps.get_workspace_id] = lambda: WORKSPACE_ID
    app.dependency_overrides[deps.get_db] = lambda: FakeDb(user)
    return TestClient(app)


def test_returns_the_signed_in_user() -> None:
    user = FakeUser(
        id=USER_ID,
        email="dev@codesageai.dev",
        display_name="Janidu",
        avatar_url="https://avatars.example/janidu.png",
        identity_provider="github",
    )

    response = _client(user).get("/api/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(USER_ID),
        "workspace_id": str(WORKSPACE_ID),
        "email": "dev@codesageai.dev",
        "name": "Janidu",
        "avatar_url": "https://avatars.example/janidu.png",
        "identity_provider": "github",
    }


def test_renders_missing_display_fields_as_null() -> None:
    """A GitHub account that keeps its email private is a cosmetic gap, not a failed sign-in."""
    user = FakeUser(
        id=USER_ID, email=None, display_name=None, avatar_url=None, identity_provider=None
    )

    response = _client(user).get("/api/auth/session")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == str(USER_ID)
    assert body["workspace_id"] == str(WORKSPACE_ID)
    assert body["email"] is None
    assert body["name"] is None
    assert body["avatar_url"] is None
    assert body["identity_provider"] is None


def test_session_is_mounted_on_the_protected_router() -> None:
    """Structural guard: unlike sign-out, this endpoint must require a session."""

    def paths(router: object) -> set[str]:
        return {r.path for r in router.routes}  # type: ignore[attr-defined]

    assert "/auth/session" in paths(auth_router.router)
    assert "/auth/session" not in paths(auth_router.public_router)
