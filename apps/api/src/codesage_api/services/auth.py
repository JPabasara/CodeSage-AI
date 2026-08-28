"""Sign-in, sessions and sign-out (FR-1, SEC-01, SEC-10, SEC-17).

The session lives in the database. The browser gets a cookie holding nothing but
a random id. Two things follow from that, and both are the point:

  * a script that steals the cookie has stolen a number, not a credential — it
    cannot be replayed against Asgardeo or GitHub;
  * signing out works immediately, because we delete the row.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import (
    Membership,
    ScoringProfile,
    User,
    UserSession,
    Workspace,
)
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import (
    NotAuthenticated,
    SignInFailed,
    UpstreamUnavailable,
)
from codesage_api.scoring.config_loader import get_presets
from codesage_api.scoring.enums import Category

logger = logging.getLogger(__name__)

# The OAuth error codes that mean "the browser's request was bad", not "Asgardeo
# is down". Both are terminal for this attempt and neither is worth retrying, so
# they must not be dressed up as a temporary outage.
_CLIENT_SIDE_GRANT_ERRORS = {"invalid_grant", "invalid_request", "expired_token"}


def _oauth_error(response: httpx.Response) -> str | None:
    """The `error` field of an OAuth error body, if there is one.

    Only this field is read, never the whole body: an error body can echo the
    client secret back, and a log is as bad a place for that as a response is.
    """
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload.get("error") if isinstance(payload, dict) else None


@dataclass(frozen=True, slots=True)
class IdentityClaims:
    """What Asgardeo tells us about the person who just signed in."""

    sub: str
    email: str | None
    name: str | None
    picture: str | None
    identity_provider: str | None


def exchange_code_for_identity(code: str, code_verifier: str) -> IdentityClaims:
    """Trade the code for the user's details. Backend to Asgardeo, directly.

    Two calls: one to swap the code for an access token, one to ask who that
    token belongs to. The token stays inside this function and is thrown away
    when it returns. Nothing about it ever reaches the browser .
    """
    settings = get_settings()
    stage = "token"
    try:
        with httpx.Client(timeout=15.0) as client:
            token_response = client.post(
                f"{settings.asgardeo_base_url}/oauth2/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.asgardeo_redirect_uri,
                    "code_verifier": code_verifier,
                },
                auth=(settings.asgardeo_client_id, settings.asgardeo_client_secret),
            )
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            stage = "userinfo"
            user_response = client.get(
                f"{settings.asgardeo_base_url}/oauth2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            user_response.raise_for_status()
            claims = user_response.json()
    except httpx.HTTPStatusError as exc:
        error = _oauth_error(exc.response)
        logger.warning(
            "sign-in %s call rejected by the identity provider: HTTP %s, oauth error %r",
            stage,
            exc.response.status_code,
            error,
        )
        if error in _CLIENT_SIDE_GRANT_ERRORS:
            raise SignInFailed from exc
        raise UpstreamUnavailable from exc
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning(
            "sign-in %s call failed before a usable answer: %s: %s",
            stage,
            type(exc).__name__,
            exc,
        )
        raise UpstreamUnavailable from exc

    return IdentityClaims(
        sub=claims["sub"],
        email=claims.get("email"),
        name=claims.get("name") or claims.get("username"),
        picture=claims.get("picture"),
        identity_provider=claims.get("idp"),
    )


def establish_session(db: DbSession, claims: IdentityClaims) -> UserSession:
    """Find or create the user, then start a session for them."""
    user = db.scalar(select(User).where(User.asgardeo_sub == claims.sub))
    if user is None:
        user = _provision_new_user(db, claims)
    else:
        # Their name or picture may have changed since last time.
        user.email = claims.email or user.email
        user.display_name = claims.name or user.display_name
        user.avatar_url = claims.picture or user.avatar_url

    workspace_id = resolve_workspace(db, user.id)

    now = datetime.now(timezone.utc)
    settings = get_settings()
    session = UserSession(
        user_id=user.id,
        workspace_id=workspace_id,
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(minutes=settings.session_idle_minutes),
    )
    db.add(session)
    db.flush()
    return session


def _provision_new_user(db: DbSession, claims: IdentityClaims) -> User:
    """First sign-in: create the user, their workspace, and a starting profile.

    Doing it here, once, means every later read can assume a workspace and an
    active profile exist. 

    Note the order. WORKSPACE, MEMBERSHIP and SCORING_PROFILE all carry a policy
    saying "this row must belong to the current workspace", and PostgreSQL checks
    that on INSERT as well as on SELECT. So the workspace id is generated here,
    bound as the current workspace, and only then written — otherwise the very
    first INSERT is refused by the policy that is meant to protect it.
    """
    user = User(
        asgardeo_sub=claims.sub,
        email=claims.email,
        display_name=claims.name,
        avatar_url=claims.picture,
        identity_provider=claims.identity_provider,
    )
    db.add(user)
    db.flush()

    workspace_id = uuid.uuid4()
    set_workspace_context(db, workspace_id)

    db.add(Workspace(id=workspace_id))
    db.flush()

    db.add(
        Membership(
            user_id=user.id,
            workspace_id=workspace_id,
            status=MembershipStatus.ACTIVE,
        )
    )

    balanced = get_presets()["balanced"]
    db.add(
        ScoringProfile(
            workspace_id=workspace_id,
            name=balanced.name,
            security_weight=balanced.weights[Category.SECURITY],
            code_design_weight=balanced.weights[Category.CODE_DESIGN],
            requirement_weight=balanced.weights[Category.REQUIREMENT],
            documentation_weight=balanced.weights[Category.DOCUMENTATION],
            test_weight=balanced.weights[Category.TEST],
            trust_slider=balanced.s,
            is_active=True,
        )
    )
    db.flush()
    return user


def resolve_workspace(db: DbSession, user_id: uuid.UUID) -> uuid.UUID:
    """Which workspace this user belongs to.

    Goes through MEMBERSHIP rather than a column on USER.
    """
    workspace_id = db.scalar(
        select(func.app_workspace_for_user(user_id)),
    )
    if workspace_id is None:
        raise NotAuthenticated
    return workspace_id


def load_valid_session(db: DbSession, raw_cookie: str | None) -> UserSession | None:
    """Turn a cookie into a session, or return None.

    Also slides the expiry forward, so someone who is actively working is not
    signed out at the hour mark — but never past the twelve-hour ceiling, which
    is what stops a session living forever just because a tab is open.
    """
    if not raw_cookie:
        return None
    try:
        session_id = uuid.UUID(raw_cookie)
    except ValueError:
        return None

    session = db.get(UserSession, session_id)
    now = datetime.now(timezone.utc)
    if session is None:
        return None
    if session.expires_at <= now:
        db.delete(session)
        return None

    settings = get_settings()
    session.last_used_at = now
    session.expires_at = min(
        now + timedelta(minutes=settings.session_idle_minutes),
        session.created_at + timedelta(hours=settings.session_absolute_hours),
    )
    return session


def end_session(db: DbSession, raw_cookie: str | None) -> None:
    """Delete the row. After this the cookie is a meaningless number """
    if not raw_cookie:
        return
    try:
        session_id = uuid.UUID(raw_cookie)
    except ValueError:
        return
    session = db.get(UserSession, session_id)
    if session is not None:
        db.delete(session)
