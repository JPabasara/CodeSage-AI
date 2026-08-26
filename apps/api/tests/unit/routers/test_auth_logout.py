"""Sign-out ends the session here AND at Asgardeo (SEC-10, J3.0).

The bug these lock down: sign-out used to delete our own session row and stop
there. Asgardeo kept its own SSO cookie, so clicking "Sign in" straight afterwards
was re-authenticated silently and handed the user a brand new session — on a shared
machine, the previous person's account.

No database here. The handler's only database work is `end_session`, so a fake
session object records what it was asked to do and the route is tested for what it
actually promises: the row goes, the cookie goes, and the browser is sent to the
identity provider.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from codesage_api import deps
from codesage_api.config import Settings
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router

ASGARDEO = "https://api.asgardeo.io/t/codesage"
FRONTEND = "https://codesageai.dev"
COOKIE = "codesage_session"
SESSION_ID = "ec196dda-fefd-454a-a4bc-33feb10ffe5f"


class FakeDb:
    """Stands in for a SQLAlchemy session, and remembers the verbs."""

    def __init__(self) -> None:
        self.ended_with: list[str | None] = []
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def settings() -> Settings:
    return Settings(
        asgardeo_base_url=ASGARDEO,
        asgardeo_client_id="client-123",
        frontend_base_url=FRONTEND,
        cookie_secure=True,
    )


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> FakeDb:
    """Wire the route to a fake database and a known configuration."""
    fake = FakeDb()

    monkeypatch.setattr(auth_router, "SessionLocal", lambda: fake)
    monkeypatch.setattr(
        auth_router.auth_service,
        "end_session",
        lambda _db, raw_cookie: fake.ended_with.append(raw_cookie),
    )
    # `get_settings` is lru_cached and read by several modules, so patch the
    # function itself rather than the environment.
    for module in (auth_router, deps):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr("codesage_api.main.get_settings", lambda: settings)
    return fake


@pytest.fixture
def client(db: FakeDb) -> TestClient:
    # `follow_redirects=False` so the 302 itself is the thing under test — with
    # redirects followed the test would try to reach Asgardeo over the network.
    return TestClient(create_app(), follow_redirects=False)


def test_deletes_the_session_row(client: TestClient, db: FakeDb) -> None:
    client.cookies.set(COOKIE, SESSION_ID)
    client.post("/api/auth/logout")

    assert db.ended_with == [SESSION_ID], "the cookie's id must reach end_session"
    assert db.committed, "an uncommitted delete is not a delete"
    assert db.closed


def test_clears_the_cookie(client: TestClient, db: FakeDb) -> None:
    client.cookies.set(COOKIE, SESSION_ID)
    response = client.post("/api/auth/logout")

    cleared = response.headers["set-cookie"]
    assert f"{COOKIE}=" in cleared
    assert "Max-Age=0" in cleared
    assert "Path=/" in cleared
    # B7: the same attributes the cookie was set with, so the pair reads together.
    assert "HttpOnly" in cleared
    assert "Secure" in cleared
    assert "SameSite=lax" in cleared


def test_redirects_to_the_identity_provider(client: TestClient, db: FakeDb) -> None:
    """B1 — the bug. Ending our own session is not signing out."""
    client.cookies.set(COOKIE, SESSION_ID)
    response = client.post("/api/auth/logout")

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith(f"{ASGARDEO}/oidc/logout")
    assert "client_id=client-123" in location
    # URL-encoded, hence the %2F.
    assert "post_logout_redirect_uri=https%3A%2F%2Fcodesageai.dev%2Flogin" in location


def test_succeeds_with_no_cookie_at_all(client: TestClient, db: FakeDb) -> None:
    """B3 — sign-out is idempotent and never 401s.

    This is the route that used to sit behind the sign-in check, so an expired
    session answered 401 and the user could never clear the cookie. Signing out
    twice must work as well as signing out once.
    """
    response = client.post("/api/auth/logout")

    assert response.status_code == 302
    assert db.ended_with == [None]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_falls_back_to_login_when_sign_in_is_not_configured(
    client: TestClient, db: FakeDb, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A half-configured server still signs you out — locally, and visibly.

    `begin_sign_in` raises on missing configuration; sign-out must not. The
    session is already gone by this point, so an error page would tell the user
    they are still signed in when they are not.
    """
    monkeypatch.setattr(settings, "asgardeo_base_url", "")
    client.cookies.set(COOKIE, SESSION_ID)

    response = client.post("/api/auth/logout")

    assert response.status_code == 302
    assert response.headers["location"] == f"{FRONTEND}/login"
    assert db.committed


def test_logout_is_mounted_on_the_public_router() -> None:
    """Structural guard for B3 — the endpoint must not carry the sign-in check.

    `test_succeeds_with_no_cookie_at_all` proves the behaviour; this one names the
    cause, so that moving the decorator back to `@router.post` fails here with an
    obvious message rather than as a puzzling 401 somewhere else.

    The protection is applied to the whole protected router in `main.create_app`,
    not per endpoint, so which router owns the route *is* the security property.
    """

    def paths(router: object) -> set[str]:
        return {r.path for r in router.routes}  # type: ignore[attr-defined]

    assert "/auth/logout" in paths(auth_router.public_router)
    assert "/auth/logout" not in paths(auth_router.router)


# ── the cookie domain (the redirect loop of 25 Aug) ─────────────────────────
#
# Symptom: sign in on the live site, land back on /login, forever. Sign-in was
# fine and the session row was real. The cookie was set host-only, so it belonged
# to api.codesageai.dev and nothing else — and `middleware.ts`, which runs on
# codesageai.dev, could not see it. Every protected route bounced to /login.
#
# Both halves are tested. Setting a domain-scoped cookie without also DELETING a
# domain-scoped one leaves a cookie no sign-out can clear, which is the same
# class of bug wearing the opposite mask.


def test_logout_clears_a_domain_scoped_cookie(
    db: FakeDb, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "cookie_domain", ".codesageai.dev")
    client = TestClient(create_app(), follow_redirects=False)
    client.cookies.set(COOKIE, SESSION_ID)

    cleared = client.post("/api/auth/logout").headers["set-cookie"]

    # A browser matches a cookie on name, domain AND path. Omit the domain here
    # and the deletion silently targets a different cookie than the one that
    # exists, so the user stays signed in with nothing able to clear it.
    assert "Domain=.codesageai.dev" in cleared
    assert "Max-Age=0" in cleared


def test_logout_leaves_the_cookie_host_only_when_no_domain_is_set(
    client: TestClient, db: FakeDb
) -> None:
    """Local development: API and frontend share `localhost`, so host-only is right."""
    client.cookies.set(COOKIE, SESSION_ID)

    cleared = client.post("/api/auth/logout").headers["set-cookie"]

    assert "Domain=" not in cleared
