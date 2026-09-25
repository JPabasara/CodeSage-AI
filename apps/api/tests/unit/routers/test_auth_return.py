"""Sign-in in one trip: `return_to`, and one silent retry of a lost handshake.

The journey these protect: a new user signs up, Asgardeo emails a verification
link, the link opens in a NEW tab and starts a fresh sign-in there. The first
tab's handshake is gone or stale by then. Before, that ended on
`/login?error=expired`, and an invitee also lost their invitation.
"""

from __future__ import annotations

import time
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import itsdangerous.timed
import pytest
from fastapi.testclient import TestClient

from codesage_api.config import Settings
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router

FRONTEND = "https://codesageai.dev"
API = "https://api.codesageai.dev"
INVITE = "/invitations/accept?token=invite-token-123"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        asgardeo_base_url="https://api.asgardeo.io/t/codesage",
        asgardeo_client_id="client-123",
        asgardeo_client_secret="secret-456",
        asgardeo_redirect_uri=f"{API}/api/auth/callback",
        frontend_base_url=FRONTEND,
        cookie_secure=False,  # TestClient speaks http; the cookie must come back
    )


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(auth_router, "get_settings", lambda: settings)
    monkeypatch.setattr("codesage_api.main.get_settings", lambda: settings)
    monkeypatch.setattr("codesage_api.config.get_settings", lambda: settings)
    return TestClient(create_app(), follow_redirects=False)


@pytest.fixture
def signs_in(monkeypatch: pytest.MonkeyPatch) -> None:
    """Asgardeo accepts the code and a session is created."""

    class _Db:
        def commit(self) -> None: ...
        def rollback(self) -> None: ...
        def close(self) -> None: ...

    monkeypatch.setattr(auth_router, "SessionLocal", _Db)
    monkeypatch.setattr(
        auth_router.auth_service, "exchange_code_for_identity", lambda code, verifier: {}
    )
    monkeypatch.setattr(
        auth_router.auth_service,
        "establish_session",
        lambda db, claims: SimpleNamespace(id=uuid.uuid4(), workspace_id=None),
    )


def _set_handshake(client: TestClient, value: str) -> None:
    """Stored the way a browser stores the server's own cookie, so a new
    Set-Cookie from /login replaces it instead of sitting beside it."""
    client.cookies.set(
        auth_router.HANDSHAKE_COOKIE, value, domain="testserver.local", path="/api/auth"
    )


def _handshake(client: TestClient) -> dict:
    raw = client.cookies.get(auth_router.HANDSHAKE_COOKIE)
    assert raw, "no handshake cookie was set"
    return auth_router._signer().loads(raw)


def _login(client: TestClient, query: str = "") -> tuple[str, dict]:
    """Start sign-in; return the `state` sent to Asgardeo and the handshake."""
    response = client.get(f"/api/auth/login{query}")
    assert response.status_code == 302
    sent = parse_qs(urlsplit(response.headers["location"]).query)
    return sent["state"][0], _handshake(client)


def _stale_handshake(client: TestClient, monkeypatch, age: int, **payload: str) -> None:
    """A handshake cookie signed `age` seconds ago."""
    with monkeypatch.context() as past:
        past.setattr(itsdangerous.timed, "time", SimpleNamespace(time=lambda: time.time() - age))
        value = auth_router._signer().dumps({"state": "old", "verifier": "old", **payload})
    _set_handshake(client, value)


# ── /login: return_to goes into the signed cookie, never to Asgardeo ────────


def test_return_to_is_kept_in_the_handshake_not_in_the_asgardeo_url(client) -> None:
    response = client.get("/api/auth/login", params={"return_to": INVITE})

    location = response.headers["location"]
    assert "invite-token" not in location and "return_to" not in location
    assert _handshake(client)["return_to"] == INVITE


@pytest.mark.parametrize(
    "unsafe", ["https://evil.example/", "//evil.example", "/login", "/%2F%2Fevil.example"]
)
def test_an_unsafe_return_to_is_ignored_not_an_error(client, unsafe: str) -> None:
    response = client.get("/api/auth/login", params={"return_to": unsafe})

    assert response.status_code == 302
    assert "return_to" not in _handshake(client)


def test_the_cookie_outlives_the_ten_minute_handshake(client) -> None:
    response = client.get("/api/auth/login", params={"return_to": INVITE})

    cookie = response.headers["set-cookie"]
    assert "Max-Age=3600" in cookie
    assert "HttpOnly" in cookie and "Path=/api/auth" in cookie


def test_a_fresh_sign_in_carries_forward_an_unfinished_return_to(client, monkeypatch) -> None:
    """The verification tab starts sign-in from the Access URL, with no
    `return_to`. It still ends on the invitation, even 30 minutes later."""
    _stale_handshake(client, monkeypatch, age=30 * 60, return_to=INVITE)

    _state, handshake = _login(client)

    assert handshake["return_to"] == INVITE


def test_an_explicit_return_to_wins_over_a_pending_one(client, monkeypatch) -> None:
    _stale_handshake(client, monkeypatch, age=60, return_to=INVITE)

    _state, handshake = _login(client, "?return_to=/profiles")

    assert handshake["return_to"] == "/profiles"


def test_a_pending_return_to_older_than_an_hour_is_forgotten(client, monkeypatch) -> None:
    _stale_handshake(client, monkeypatch, age=2 * 60 * 60, return_to=INVITE)

    _state, handshake = _login(client)

    assert "return_to" not in handshake


def test_a_retry_marks_its_state(client) -> None:
    state, handshake = _login(client, "?retry=true")

    assert state.endswith(auth_router.RETRY_STATE_SUFFIX)
    assert handshake["state"] == state
    plain, _ = _login(client)
    assert not plain.endswith(auth_router.RETRY_STATE_SUFFIX)


# ── /callback: one silent retry, never a loop ───────────────────────────────


def test_a_missing_handshake_restarts_sign_in_once_on_the_api_host(client) -> None:
    response = client.get("/api/auth/callback?code=c&state=whatever")

    assert response.status_code == 302
    assert response.headers["location"] == f"{API}/api/auth/login?retry=true"


def test_an_expired_handshake_restarts_sign_in(client, monkeypatch) -> None:
    _stale_handshake(client, monkeypatch, age=11 * 60)

    response = client.get("/api/auth/callback?code=c&state=old")

    assert response.headers["location"] == f"{API}/api/auth/login?retry=true"


@pytest.mark.parametrize("problem", ["forged", "mismatched"])
def test_an_invalid_handshake_restarts_sign_in(client, problem: str) -> None:
    if problem == "forged":
        _set_handshake(client, "not-a-signed-value")
        state = "whatever"
    else:
        _login(client)  # a second sign-in replaced the first tab's handshake
        state = "the-first-tabs-state"

    response = client.get(f"/api/auth/callback?code=c&state={state}")

    assert response.headers["location"] == f"{API}/api/auth/login?retry=true"


@pytest.mark.parametrize(
    ("setup", "reason"),
    [("missing", "expired"), ("forged", "invalid")],
)
def test_a_retry_that_fails_again_goes_to_the_login_page(client, setup: str, reason: str) -> None:
    """The marker rides in `state`, which Asgardeo echoes back, so this holds even
    for a browser that keeps no cookies at all."""
    if setup == "forged":
        _set_handshake(client, "not-a-signed-value")

    response = client.get(
        f"/api/auth/callback?code=c&state=abc{auth_router.RETRY_STATE_SUFFIX}"
    )

    assert response.headers["location"] == f"{FRONTEND}/login?error={reason}"


def test_a_refused_code_is_not_retried(client, monkeypatch) -> None:
    """A spent or wrong code will be refused again; only a lost handshake is."""
    from codesage_api.errors import SignInFailed

    def refuse(code: str, verifier: str) -> None:
        raise SignInFailed

    monkeypatch.setattr(auth_router.auth_service, "exchange_code_for_identity", refuse)
    state, _ = _login(client)

    response = client.get(f"/api/auth/callback?code=c&state={state}")

    assert response.headers["location"] == f"{FRONTEND}/login?error=failed"


# ── landing ──────────────────────────────────────────────────────────────────


def test_sign_in_lands_on_return_to(client, signs_in) -> None:
    state, _ = _login(client, f"?return_to={INVITE.replace('?', '%3F').replace('=', '%3D')}")

    response = client.get(f"/api/auth/callback?code=c&state={state}")

    assert response.headers["location"] == f"{FRONTEND}{INVITE}"


def test_sign_in_without_return_to_lands_on_projects(client, signs_in) -> None:
    state, _ = _login(client)

    response = client.get(f"/api/auth/callback?code=c&state={state}")

    assert response.headers["location"] == f"{FRONTEND}/projects"


def test_a_signed_but_unsafe_return_to_is_still_refused_at_the_callback(
    client, signs_in
) -> None:
    """Checked again on the way out, so a cookie written by an older build, or
    with a leaked secret, still cannot redirect anywhere else."""
    _set_handshake(
        client,
        auth_router._signer().dumps(
            {"state": "s", "verifier": "v", "return_to": "//evil.example"}
        ),
    )

    response = client.get("/api/auth/callback?code=c&state=s")

    assert response.headers["location"] == f"{FRONTEND}/projects"


def test_the_whole_verification_journey_ends_on_the_invitation(
    client, signs_in, monkeypatch
) -> None:
    """Tab A starts an invite sign-in; the user verifies their email slowly; the
    callback finds the handshake expired, retries silently, and the invitee
    still lands on the invitation, having typed nothing twice."""
    _stale_handshake(client, monkeypatch, age=20 * 60, return_to=INVITE)

    first = client.get("/api/auth/callback?code=c1&state=old")
    assert first.headers["location"] == f"{API}/api/auth/login?retry=true"

    retry = client.get("/api/auth/login?retry=true")
    state = parse_qs(urlsplit(retry.headers["location"]).query)["state"][0]
    landed = client.get(f"/api/auth/callback?code=c2&state={state}")

    assert landed.headers["location"] == f"{FRONTEND}{INVITE}"
    # Consumed: the next sign-in in this browser starts clean.
    assert auth_router.HANDSHAKE_COOKIE not in client.cookies
