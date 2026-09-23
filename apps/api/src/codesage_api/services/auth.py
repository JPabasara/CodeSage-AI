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
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, Repository, User, UserSession, Workspace
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import (
    NotAuthenticated,
    SignInFailed,
    UpstreamUnavailable,
)
from codesage_api.services import profiles
from codesage_api.services.memberships import get_active_membership

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
    email_verified: bool = False


@dataclass(frozen=True, slots=True)
class ActiveWorkspace:
    workspace_id: uuid.UUID
    name: str
    role_id: str
    description: str | None = None
    website_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    project_count: int = 0
    member_count: int = 0


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
        email_verified=claims.get("email_verified") is True,
    )


def establish_session(db: DbSession, claims: IdentityClaims) -> UserSession:
    """Find or create the user, then start a session for them."""
    user = db.scalar(select(User).where(User.asgardeo_sub == claims.sub))
    if user is None:
        user = _provision_new_user(db, claims)
    else:
        # Their name or picture may have changed since last time.
        user.email = claims.email or user.email
        user.email_verified = claims.email_verified
        user.display_name = claims.name or user.display_name
        user.avatar_url = claims.picture or user.avatar_url

    # May be None: a brand-new user, or one whose only memberships were revoked.
    # That is a valid signed-in state, not a failure — the web sends them to
    # workspace onboarding, and every workspace-bound endpoint refuses them with
    # WORKSPACE_REQUIRED until they have one.
    workspace_id = resolve_workspace(db, user.id)
    if workspace_id is not None:
        set_workspace_context(db, workspace_id)
        if get_active_membership(db, user.id, workspace_id) is None:
            raise NotAuthenticated

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
    """First sign-in: create the person, and nothing else.

    No workspace and no repository. Naming a workspace is the first thing the
    product asks the user to do, and a "My Workspace" invented here would be a
    name nobody chose, sitting in the switcher next to the real one they create a
    moment later.
    """
    user = User(
        asgardeo_sub=claims.sub,
        email=claims.email,
        display_name=claims.name,
        avatar_url=claims.picture,
        identity_provider=claims.identity_provider,
        email_verified=claims.email_verified,
    )
    db.add(user)
    db.flush()
    return user


def _create_workspace_records(
    db: DbSession,
    user_id: uuid.UUID,
    *,
    name: str,
    description: str | None = None,
    website_url: str | None = None,
) -> uuid.UUID:
    """Create a ready-to-use workspace owned by ``user_id`` in this transaction.

    Workspace, org-admin membership, three built-in profiles and a Balanced
    default, all in one unit of work — so a half-created workspace can never be
    reached by the next request. No repository is created: a new workspace is
    genuinely empty, and the Projects page says so.

    Note the order. WORKSPACE, MEMBERSHIP, SCORING_PROFILE and
    WORKSPACE_PROFILE_SETTINGS all carry a policy saying "this row must belong to
    the current workspace", and PostgreSQL checks that on INSERT as well as on
    SELECT. So the workspace id is generated here, bound as the current
    workspace, and only then written — otherwise the very first INSERT is refused
    by the policy that is meant to protect it.
    """
    workspace_id = uuid.uuid4()
    set_workspace_context(db, workspace_id)

    db.add(
        Workspace(
            id=workspace_id,
            name=name,
            description=description,
            website_url=website_url,
        )
    )
    db.flush()
    db.add(
        Membership(
            user_id=user_id,
            workspace_id=workspace_id,
            status=MembershipStatus.ACTIVE,
            role_id="org-admin",
        )
    )
    profiles.seed_workspace_profiles(db, workspace_id, actor_user_id=user_id)
    db.flush()
    return workspace_id


def create_workspace(
    db: DbSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
    description: str | None = None,
    website_url: str | None = None,
) -> ActiveWorkspace | None:
    """Create a workspace for a signed-in user and select it for this session.

    This is both the onboarding path and the "add another workspace" path; the
    only difference is whether the session had a workspace beforehand.

    The session switch performs the final ownership and active-session check. If
    that check fails, the caller rolls back the transaction, including every new
    workspace record created above.
    """
    workspace_id = _create_workspace_records(
        db, user_id, name=name, description=description, website_url=website_url
    )
    return switch_session_workspace(
        db,
        session_id=session_id,
        user_id=user_id,
        workspace_id=workspace_id,
    )


def resolve_workspace(db: DbSession, user_id: uuid.UUID) -> uuid.UUID | None:
    """Which workspace to put this user back into, or None if they have none.

    Goes through MEMBERSHIP rather than a column on USER, and the lookup is
    deterministic: the workspace of their most recent session, falling back to
    the lowest workspace id. Belonging to two workspaces used to mean landing in
    an arbitrary one of them on each sign-in.
    """
    return db.scalar(select(func.app_workspace_for_user(user_id)))


def list_active_workspaces(
    db: DbSession, *, session_id: uuid.UUID, user_id: uuid.UUID
) -> list[ActiveWorkspace]:
    """Discover only this authenticated user's active memberships.

    The SECURITY DEFINER function is required because no workspace is bound
    while discovering the set. It returns no user profile or membership rows.
    """
    rows = db.execute(
        text(
            "SELECT workspace_id, role_id "
            "FROM app_active_workspaces_for_session(:session_id, :user_id)"
        ),
        {"session_id": session_id, "user_id": user_id},
    ).all()
    workspaces = []
    for row in rows:
        set_workspace_context(db, row.workspace_id)
        workspace = db.get(Workspace, row.workspace_id)
        if workspace is not None:
            workspaces.append(describe_workspace(db, workspace, row.role_id))
    return workspaces


def describe_workspace(
    db: DbSession, workspace: Workspace, role_id: str
) -> ActiveWorkspace:
    """One workspace plus the two counts the switcher and settings screen show.

    Counted here rather than stored on the row: both change whenever a project or
    a member does, and a cached copy would be wrong more often than it was right.
    The caller must already have bound this workspace, so row-level security is
    what keeps the counts to it.
    """
    project_count = db.scalar(
        select(func.count()).select_from(Repository).where(
            Repository.workspace_id == workspace.id
        )
    )
    member_count = db.scalar(
        select(func.count()).select_from(Membership).where(
            Membership.workspace_id == workspace.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    return ActiveWorkspace(
        workspace_id=workspace.id,
        name=workspace.name,
        role_id=role_id,
        description=workspace.description,
        website_url=workspace.website_url,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        project_count=project_count or 0,
        member_count=member_count or 0,
    )


def switch_session_workspace(
    db: DbSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> ActiveWorkspace | None:
    """Switch one server-side session after an atomic active-membership check."""
    switched = db.scalar(
        select(func.app_switch_session_workspace(session_id, user_id, workspace_id))
    )
    if not switched:
        return None
    return next(
        (
            workspace
            for workspace in list_active_workspaces(db, session_id=session_id, user_id=user_id)
            if workspace.workspace_id == workspace_id
        ),
        None,
    )


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

    # A valid cookie is not sufficient once membership has been revoked.
    # Bind only the workspace recorded by the server-side session, then check
    # the current membership. Do not activate invitations during sign-in.
    #
    # A session with no workspace skips both checks and stays valid: there is no
    # membership to verify, and nothing it can reach needs one. Binding "None" as
    # a tenant would be a type error, and deleting the session would sign the
    # user out of onboarding halfway through naming their first workspace.
    if session.workspace_id is not None:
        set_workspace_context(db, session.workspace_id)
        if get_active_membership(db, session.user_id, session.workspace_id) is None:
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
    """Delete the row. After this the cookie is a meaningless number"""
    if not raw_cookie:
        return
    try:
        session_id = uuid.UUID(raw_cookie)
    except ValueError:
        return
    session = db.get(UserSession, session_id)
    if session is not None:
        db.delete(session)
