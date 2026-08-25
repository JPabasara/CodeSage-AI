"""GET /api/auth/callback — what happens when Asgardeo says no.

The bug these lock down: every refusal from the identity provider came back as
503 UPSTREAM_UNAVAILABLE, "a service we depend on is temporarily unavailable".

That sentence is true for an outage and false for everything else. A spent
authorization code, an expired one, a client mismatch: Asgardeo is up and
answering, it is simply refusing this attempt. Retrying cannot help. Saying
"try again" is the one piece of advice guaranteed not to work.

Refreshing the callback URL hits this every single time, because an
authorization code is single use and a reload replays a spent one.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from codesage_api.config import Settings
from codesage_api.errors import SignInFailed, UpstreamUnavailable
from codesage_api.main import create_app
from codesage_api.routers import auth as auth_router
from codesage_api.services import auth as auth_service

FRONTEND = "https://codesageai.dev"
STATE = "the-state-we-sent"
VERIFIER = "the-verifier-we-kept"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        asgardeo_base_url="https://api.asgardeo.io/t/codesage",
        asgardeo_client_id="client-123",
        asgardeo_client_secret="secret-456",
        frontend_base_url=FRONTEND,
        cookie_secure=True,
    )


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A client carrying a VALID handshake cookie, so the state check passes.

    Everything here is about what happens after that point; the handshake itself
    has its own failure paths and its own redirects.
    """
    for module in (auth_router,):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr("codesage_api.main.get_settings", lambda: settings)
    monkeypatch.setattr("codesage_api.config.get_settings", lambda: settings)

    test_client = TestClient(create_app(), follow_redirects=False)
    handshake = auth_router._signer().dumps({"state": STATE, "verifier": VERIFIER})
    test_client.cookies.set(auth_router.HANDSHAKE_COOKIE, handshake)
    return test_client


def _callback(client: TestClient) -> httpx.Response:
    return client.get(f"/api/auth/callback?code=some-code&state={STATE}")


def test_a_refused_code_sends_the_browser_back_to_login(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Terminal for this attempt, so the only way forward is to start again.

    Whoever is reading this is a person mid-navigation, not a script. JSON they
    cannot act on is the wrong answer; the login page is the right one.

    Classifying the refusal is the service's job, tested below; the router's job
    is only what it does with the answer, so `SignInFailed` is what it is handed.
    """

    def refuse(code: str, verifier: str) -> None:
        raise SignInFailed

    monkeypatch.setattr(auth_router.auth_service, "exchange_code_for_identity", refuse)

    response = _callback(client)

    assert response.status_code == 302
    assert response.headers["location"] == f"{FRONTEND}/login?error=failed"


def test_a_real_outage_is_still_a_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The distinction only earns its keep if the other half still works."""

    def unavailable(code: str, verifier: str) -> None:
        raise UpstreamUnavailable

    monkeypatch.setattr(
        auth_router.auth_service, "exchange_code_for_identity", unavailable
    )

    response = _callback(client)

    assert response.status_code == 503
    assert response.json()["code"] == "UPSTREAM_UNAVAILABLE"


# ── the service layer's own classification ──────────────────────────────────


def _exchange_against(monkeypatch: pytest.MonkeyPatch, response: httpx.Response):
    """Run the real exchange against a canned Asgardeo answer."""

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def post(self, *_: object, **__: object) -> httpx.Response:
            return response

        def get(self, *_: object, **__: object) -> httpx.Response:
            return response

    monkeypatch.setattr(httpx, "Client", lambda **_: FakeClient())
    return auth_service.exchange_code_for_identity("some-code", VERIFIER)


def test_invalid_grant_is_classified_as_a_failed_sign_in(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("codesage_api.services.auth.get_settings", lambda: settings)
    request = httpx.Request("POST", "https://example.test/oauth2/token")
    refused = httpx.Response(400, json={"error": "invalid_grant"}, request=request)

    with pytest.raises(SignInFailed):
        _exchange_against(monkeypatch, refused)


def test_a_server_error_from_asgardeo_is_an_outage(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """5xx really is "try again later", so it keeps the retryable answer."""
    monkeypatch.setattr("codesage_api.services.auth.get_settings", lambda: settings)
    request = httpx.Request("POST", "https://example.test/oauth2/token")
    broken = httpx.Response(502, json={"error": "server_error"}, request=request)

    with pytest.raises(UpstreamUnavailable):
        _exchange_against(monkeypatch, broken)


class _Capture(logging.Handler):
    """Collect records straight off one logger.

    NOT pytest's `caplog`. `caplog` hangs its handler on the ROOT logger, and
    `configure_logging` does `root.handlers = [handler]`, which throws it away.
    `create_app()` calls that, so what caplog sees depends on test order.

    Listening to the one logger under test has no such ordering problem.
    """

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def sign_in_logs() -> "Iterator[_Capture]":
    """Listen to the sign-in logger, whatever else has happened to logging.

    `disabled` is reset explicitly. Alembic's `env.py` runs `fileConfig`, which
    used to silence every `codesage_api.*` logger for the rest of the process,
    so this test passed on a laptop with no Docker and failed on CI, where the
    integration tests run a migration first. `env.py` no longer does that, and
    this line means no future logging change can make this test lie either.
    """
    logger = logging.getLogger("codesage_api.services.auth")
    capture = _Capture()
    previous_level, previously_disabled = logger.level, logger.disabled
    logger.setLevel(logging.WARNING)
    logger.disabled = False
    logger.addHandler(capture)
    try:
        yield capture
    finally:
        logger.removeHandler(capture)
        logger.setLevel(previous_level)
        logger.disabled = previously_disabled


def test_the_refusal_is_logged_without_leaking_the_body(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    sign_in_logs: _Capture,
) -> None:
    """The reason has to reach the logs, and the body must not.

    This is the whole point of the change. The code used to claim in a comment
    that "the full exception is still logged" while logging nothing at all, so a
    live failure produced a 503 and complete silence, and the cause had to be
    guessed at.

    Only the OAuth `error` field is logged. An error body can echo the client
    secret back, and a log file is as bad a place for that as a response is.
    """
    monkeypatch.setattr("codesage_api.services.auth.get_settings", lambda: settings)
    request = httpx.Request("POST", "https://example.test/oauth2/token")
    refused = httpx.Response(
        401,
        json={"error": "invalid_client", "client_secret": "secret-456"},
        request=request,
    )

    with pytest.raises(UpstreamUnavailable):
        _exchange_against(monkeypatch, refused)

    logged = " ".join(record.getMessage() for record in sign_in_logs.records)
    assert "invalid_client" in logged, "the reason must reach the logs"
    assert "401" in logged
    assert "token" in logged, "which of the two calls failed"
    assert "secret-456" not in logged, "the body must never be logged"
