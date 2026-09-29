"""DBR-29: no credential is stored in a form that could be replayed."""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from codesage_api.config import get_settings
from codesage_api.services.auth import IdentityClaims

from .scans import api_client, sign_in
from .test_account_provisioning import account as account  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

COOKIE = get_settings().session_cookie_name
CREDENTIAL_NAME = r"(token|secret|password)"


def _claims() -> IdentityClaims:
    return IdentityClaims(str(uuid.uuid4()), "person@example.test", "Person", None, "github", True)


def _session_matches(engine, raw: str) -> int:
    with Session(engine) as db:
        return db.scalar(
            text(
                "SELECT count(*) FROM session "
                "WHERE id::text = :c OR token_hash = convert_to(:c, 'UTF8')"
            ),
            {"c": raw},
        )


def test_session_table_never_holds_the_cookie(account, monkeypatch) -> None:
    engine = account[0]
    client = api_client(engine, account[4], monkeypatch)
    raw = sign_in(client, monkeypatch, _claims())

    assert _session_matches(engine, raw) == 0
    with Session(engine) as db:
        # What *is* stored is the digest, and the raw value appears in no column.
        assert db.scalar(
            text("SELECT count(*) FROM session WHERE token_hash = :h"),
            {"h": hashlib.sha256(raw.encode()).digest()},
        ) == 1
        assert db.scalar(
            text("SELECT count(*) FROM session s WHERE s::text LIKE '%' || :c || '%'"),
            {"c": raw},
        ) == 0


def test_the_cookie_authenticates_and_the_row_id_does_not(account, monkeypatch) -> None:
    engine = account[0]
    client = api_client(engine, account[4], monkeypatch)
    raw = sign_in(client, monkeypatch, _claims())
    assert client.get("/api/auth/session").status_code == 200

    with Session(engine) as db:
        session_id = db.scalar(
            text("SELECT id FROM session WHERE token_hash = :h"),
            {"h": hashlib.sha256(raw.encode()).digest()},
        )
    client.cookies.set(COOKIE, str(session_id))
    response = client.get("/api/auth/session")
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


def test_signed_out_cookie_is_rejected(account, monkeypatch) -> None:
    engine = account[0]
    client = api_client(engine, account[4], monkeypatch)
    raw = sign_in(client, monkeypatch, _claims())

    assert client.post("/api/auth/logout", follow_redirects=False).status_code == 302
    client.cookies.set(COOKIE, raw)
    assert client.get("/api/auth/session").status_code == 401
    assert _session_matches(engine, raw) == 0


def test_invitation_stores_only_the_token_digest(account, monkeypatch) -> None:
    from codesage_api.routers import members as members_router

    engine = account[0]
    monkeypatch.setattr(members_router, "send_workspace_invitation", lambda **_kwargs: None)
    client = api_client(engine, account[4], monkeypatch)
    created = client.post("/api/invitations", json={"email": "guest@example.test", "role": "viewer"})
    assert created.status_code == 201, created.text
    raw = created.json()["invitation_url"].split("token=", 1)[1]

    with Session(engine) as db:
        assert db.scalar(
            text("SELECT count(*) FROM workspace_invitation WHERE token_hash = :h"),
            {"h": hashlib.sha256(raw.encode()).digest()},
        ) == 1
        assert db.scalar(
            text("SELECT count(*) FROM workspace_invitation w WHERE w::text LIKE '%' || :c || '%'"),
            {"c": raw},
        ) == 0


def test_every_credential_shaped_column_is_a_digest(account) -> None:
    """Catalog guard: a new `*_token`/`*secret*`/`*password*` column must be bytea."""
    with Session(account[0]) as db:
        offenders = db.execute(
            text(
                "SELECT table_name || '.' || column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name ~* :pattern "
                "AND data_type <> 'bytea'"
            ),
            {"pattern": CREDENTIAL_NAME},
        ).all()
        # Guard the guard: the known digests are actually matched by the pattern.
        matched = set(
            db.scalars(
                text(
                    "SELECT table_name || '.' || column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND column_name ~* :pattern"
                ),
                {"pattern": CREDENTIAL_NAME},
            )
        )
    assert offenders == []
    assert {"session.token_hash", "workspace_invitation.token_hash"} <= matched
