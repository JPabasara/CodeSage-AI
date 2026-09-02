from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.models import User
from codesage_api.db.session import SessionLocal
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.errors import MisconfiguredSignIn, SignInFailed
from codesage_api.schemas.auth import SessionOut
from codesage_api.services import auth as auth_service

public_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(prefix="/auth", tags=["auth"])


HANDSHAKE_COOKIE = "codesage_signin"
HANDSHAKE_SECONDS = 600


def _signer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="codesage-signin")


@public_router.get("/login")
def begin_sign_in() -> RedirectResponse:
    """Send the browser to Asgardeo to sign in.

    This is a navigation, not a fetch — the browser has to leave the page.
    """
    settings = get_settings()

    # Fail loudly on a half-configured service. Without this, an empty base URL
    # produces a *relative* redirect to /oauth2/authorize, the browser resolves
    # it against this host, and the user gets a bare 404 that says nothing about
    # the real cause — a missing environment variable.
    if not settings.asgardeo_base_url or not settings.asgardeo_client_id:
        raise MisconfiguredSignIn

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )

    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.asgardeo_client_id,
            "redirect_uri": settings.asgardeo_redirect_uri,
            "scope": "openid profile email",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(
        f"{settings.asgardeo_base_url}/oauth2/authorize?{query}",
        status_code=status.HTTP_302_FOUND,
    )
    response.set_cookie(
        key=HANDSHAKE_COOKIE,
        value=_signer().dumps({"state": state, "verifier": verifier}),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=HANDSHAKE_SECONDS,
        path="/api/auth",
    )
    return response


@public_router.get("/callback")
def complete_sign_in(code: str, state: str, request: Request) -> RedirectResponse:

    settings = get_settings()

    handshake = request.cookies.get(HANDSHAKE_COOKIE)
    if not handshake:
        return _back_to_login("expired")
    try:
        issued = _signer().loads(handshake, max_age=HANDSHAKE_SECONDS)
    except BadSignature:
        return _back_to_login("invalid")
    if not secrets.compare_digest(issued["state"], state):
        return _back_to_login("invalid")

    try:
        claims = auth_service.exchange_code_for_identity(code, issued["verifier"])
    except SignInFailed:
      
        return _back_to_login("failed")

    db = SessionLocal()
    try:
        session = auth_service.establish_session(db, claims)
        session_id = str(session.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    response = RedirectResponse(
        f"{settings.frontend_base_url}/projects", status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,            # a random id, never a token
        httponly=True,               # JavaScript cannot read it, so XSS cannot steal it
        secure=settings.cookie_secure,
        samesite="lax",              # another website cannot make the browser send it
        max_age=settings.session_idle_minutes * 60,
        path="/",
        domain=settings.cookie_domain or None,
    )
    response.delete_cookie(HANDSHAKE_COOKIE, path="/api/auth")
    return response


def _back_to_login(reason: str) -> RedirectResponse:
    settings = get_settings()
    return RedirectResponse(
        f"{settings.frontend_base_url}/login?error={reason}",
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/session", response_model=SessionOut)
def current_user(
    user_id: uuid.UUID = Depends(get_current_user_id),
    workspace_id: uuid.UUID = Depends(get_workspace_id),
    db: DbSession = Depends(get_db),
) -> SessionOut:

    user = db.get_one(User, user_id)
    return SessionOut(
        user_id=str(user_id),
        workspace_id=str(workspace_id),
        email=user.email,
        name=user.display_name,
        avatar_url=user.avatar_url,
        identity_provider=user.identity_provider,
    )


def _post_logout_redirect() -> str:

    return f"{get_settings().frontend_base_url}/login"


def _idp_logout_url() -> str:

    settings = get_settings()
    if not settings.asgardeo_base_url or not settings.asgardeo_client_id:
        return _post_logout_redirect()

    query = urlencode(
        {
            "client_id": settings.asgardeo_client_id,
            "post_logout_redirect_uri": _post_logout_redirect(),
        }
    )
    return f"{settings.asgardeo_base_url}/oidc/logout?{query}"


@public_router.post("/logout")
def sign_out(request: Request) -> RedirectResponse:

    settings = get_settings()

    db = SessionLocal()
    try:
        auth_service.end_session(db, request.cookies.get(settings.session_cookie_name))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    response = RedirectResponse(_idp_logout_url(), status_code=status.HTTP_302_FOUND)

    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        domain=settings.cookie_domain or None,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    return response
