"""Sign-in, sessions and sign-out (FR-1, SEC-01, SEC-10, SEC-17).

The session lives in the database. The browser gets an opaque random token while
the database stores only its SHA-256 digest. Two things follow from that:

  * a database reader cannot turn the session table into live browser sessions;
  * signing out works immediately, because we delete the row.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.enums import (
    AnalysisStatus,
    MembershipStatus,
)
from codesage_api.db.models import (
    AnalysisAttempt,
    Branch,
    Membership,
    Repository,
    User,
    UserSession,
    Workspace,
)
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import (
    LastWorkspaceAdmin,
    NotAuthenticated,
    NotFound,
    SignInFailed,
    UpstreamUnavailable,
    WorkspaceConfirmationMismatch,
    WorkspaceScanRunning,
)
from codesage_api.services import audit, profiles
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
    raw_token = secrets.token_urlsafe(32)
    session = UserSession(
        token_hash=_token_hash(raw_token),
        user_id=user.id,
        workspace_id=workspace_id,
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(minutes=settings.session_idle_minutes),
    )
    db.add(session)
    db.flush()
    # Request-local hint for the callback redirect. Durable tour state remains
    # on the user and is also returned by GET /auth/session.
    session.product_tour_required = user.product_tour_completed_at is None  # type: ignore[attr-defined]
    session.raw_token = raw_token  # type: ignore[attr-defined]
    return session


def _token_hash(raw_token: str) -> bytes:
    return hashlib.sha256(raw_token.encode("utf-8")).digest()


def _provision_new_user(db: DbSession, claims: IdentityClaims) -> User:
    """Create a ready-to-use account on the first sign-in.

    The workspace, membership, and profiles are created in the caller's
    transaction. A failure therefore cannot leave a half-provisioned account
    behind. The workspace starts empty so the user can connect their own project.
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
    _create_workspace_records(db, user.id, name="My Workspace")
    return user


def complete_product_tour(db: DbSession, user_id: uuid.UUID) -> None:
    """Prevent automatic relaunch after either Finish or Skip."""
    user = db.get_one(User, user_id)
    user.product_tour_completed_at = datetime.now(timezone.utc)
    db.flush()


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


def delete_workspace(
    db: DbSession,
    *,
    workspace_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    confirmation_name: str,
) -> None:
    """Delete one tenant atomically after an exact-name and active-scan check.

    Sessions bound to it move to the no-workspace state in the same transaction.
    """
    workspace = db.scalar(
        select(Workspace).where(Workspace.id == workspace_id).with_for_update()
    )
    if workspace is None:
        raise NotFound
    if not secrets.compare_digest(
        workspace.name.encode("utf-8"), confirmation_name.encode("utf-8")
    ):
        raise WorkspaceConfirmationMismatch
    active = db.scalar(
        select(AnalysisAttempt.id)
        .join(Branch, AnalysisAttempt.branch_id == Branch.id)
        .join(Repository, Branch.repository_id == Repository.id)
        .where(
            Repository.workspace_id == workspace_id,
            AnalysisAttempt.status.in_((AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)),
        )
        .limit(1)
    )
    if active is not None:
        raise WorkspaceScanRunning
    audit.record(
        db,
        event_type="workspace_deleted",
        outcome="success",
        workspace_id=workspace_id,
        workspace_name=workspace.name,
        actor_user_id=actor_user_id,
        resource_type="workspace",
        resource_id=str(workspace_id),
    )
    # Every session bound here, the caller's included, drops to the
    # no-workspace state rather than being deleted with the tenant. Nobody is
    # signed out: they land where onboarding starts, and any other workspace
    # they belong to is one switch away. SESSION is not tenant-scoped, so this
    # reaches other members' sessions as well.
    db.execute(
        update(UserSession)
        .where(UserSession.workspace_id == workspace_id)
        .values(workspace_id=None)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    # A Core DELETE, not `db.delete(workspace)`: the ORM would load each child
    # collection and try to NULL the audit rows itself, and the application role
    # may not UPDATE the append-only audit table. The foreign keys do the work:
    # tenant data cascades, audit rows keep `workspace_name` with a NULL id.
    db.execute(delete(Workspace).where(Workspace.id == workspace_id))
    db.expunge(workspace)


def anonymize_user(
    db: DbSession, *, session_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Remove access and personal fields while retaining shared workspace facts."""
    changed = db.scalar(select(func.app_anonymize_user(session_id, user_id)))
    if not changed:
        raise LastWorkspaceAdmin
    audit.record(
        db,
        event_type="account_deleted",
        outcome="success",
        resource_type="app_user",
        resource_id=str(user_id),
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
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == _token_hash(raw_cookie))
    )
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


def end_session(db: DbSession, raw_cookie: str | None) -> UserSession | None:
    """Delete the row. After this the cookie is a meaningless random string.

    Returns the ended session so the caller can audit whose it was.
    """
    if not raw_cookie:
        return None
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == _token_hash(raw_cookie))
    )
    if session is not None:
        db.delete(session)
    return session
