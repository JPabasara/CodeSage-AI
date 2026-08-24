"""Sign-in, session and sign-out (SRS FR-1, SEC-01, SEC-10, SEC-17).

Two routers, and the split is the security boundary. `public_router` is mounted
without the sign-in check, because you obviously cannot require a session on the
endpoints whose job is to create one — or, in sign-out's case, to destroy one.
Everything else goes on `router`.
"""

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
from codesage_api.errors import MisconfiguredSignIn
from codesage_api.schemas.auth import SessionOut
from codesage_api.services import auth as auth_service

public_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(prefix="/auth", tags=["auth"])

# Holds `state` and `code_verifier` between the redirect out and the redirect
# back. Ten minutes, and only this one path can read it.
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
    """Where Asgardeo sends the browser back to.

    Checks the trip is the one we started, swaps the code for the user's details
    from this server, saves a session, and hands the browser a cookie.

    Failures here go back to the login page with a message rather than showing
    JSON — whoever is reading this is a person mid-navigation, not a script.
    """
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

    claims = auth_service.exchange_code_for_identity(code, issued["verifier"])

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
    """Who is signed in. The only auth endpoint the frontend calls with fetch.

    `user_id` and `workspace_id` are already proven by `get_current_user_id` — a
    request that reached this line has a valid session row naming both. The one
    piece still to fetch is the display info that lives on the user row itself.
    """
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
    """Where the browser ends up once everyone has forgotten the user.

    Must be registered in the Asgardeo console as an allowed sign-out redirect
    URL. Asgardeo refuses an unregistered one outright, and the symptom is an
    error page instead of a redirect home.
    """
    return f"{get_settings().frontend_base_url}/login"


def _idp_logout_url() -> str:
    """Asgardeo's sign-out endpoint, or the login page if sign-in is not set up.

    Unlike `begin_sign_in`, this never raises on a half-configured service.
    Sign-out has already deleted the session by the time it is called, and
    refusing to redirect would strand the user on an error page while actually
    being signed out. A misconfigured server signs you out locally and says so
    by going straight to the login page.

    No `id_token_hint`: we do not store the id token, and adding it is a schema
    change. `client_id` with `post_logout_redirect_uri` is the supported
    alternative. The trade-off is that Asgardeo may show its own "do you want to
    log out?" confirmation first.
    """
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
    """End the session here *and* at Asgardeo, then go to the login page (SEC-10).

    **Deleting our own row is not signing out.** Asgardeo keeps its own SSO
    cookie, so a user who signs out and clicks "Sign in" is re-authenticated
    silently — no screen, no password — and gets a brand new session. On a shared
    machine that hands the next person the previous account. Ending the session
    at the identity provider as well is what OIDC calls RP-initiated logout, and
    it is the whole reason this endpoint redirects instead of answering 204.

    **Which is why sign-out is a navigation, not a fetch.** The browser has to
    physically visit Asgardeo for Asgardeo to clear its cookie; a background
    request stays on our page and cannot. The frontend submits a form, exactly as
    sign-in is an `<a>` link. It stays a POST rather than a link because a GET is
    prefetchable, and something that ends a session must not fire because a
    browser guessed at a URL.

    **Public, and deliberately so.** This is the one endpoint that must work
    without a valid session. Signing out twice, or after the hour-long idle
    timeout, still has to clear the cookie and still has to land somewhere
    sensible — requiring a live session before you are allowed to end it leaves
    the user holding a dead cookie with no way to drop it.
    """
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
    # Same attributes the cookie was SET with. A browser matches on name, domain
    # and path, so a mismatch here is not fatal today — but the pair should be
    # read together, and a future domain-scoped cookie would not clear at all.
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    return response
