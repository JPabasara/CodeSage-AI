from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session as DbSession

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.config import get_settings
from codesage_api.db.models import User, Workspace
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import SessionLocal
from codesage_api.deps import (
    get_authorization_context,
    get_current_session_id,
    get_current_user_id,
    get_db,
    get_optional_workspace_id,
    require_permission,
)
from codesage_api.errors import Forbidden, MisconfiguredSignIn, NotFound, SignInFailed
from codesage_api.schemas.auth import (
    CreateWorkspaceIn,
    SessionOut,
    SwitchWorkspaceIn,
    UpdateWorkspaceIn,
    WorkspaceSummaryOut,
)
from codesage_api.services import auth as auth_service
from codesage_api.services.memberships import (
    resolve_authorization_context,
)

public_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(prefix="/auth", tags=["auth"])


HANDSHAKE_COOKIE = "codesage_signin"
HANDSHAKE_SECONDS = 600
WorkspaceAdmin = Annotated[AuthorizationContext, Depends(require_permission("workspace:update"))]


def _summary(workspace: auth_service.ActiveWorkspace, *, is_active: bool) -> WorkspaceSummaryOut:
    return WorkspaceSummaryOut(
        workspace_id=str(workspace.workspace_id),
        name=workspace.name,
        role=workspace.role_id,
        is_active=is_active,
        description=workspace.description,
        website_url=workspace.website_url,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        project_count=workspace.project_count,
        member_count=workspace.member_count,
    )


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
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
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
        needs_workspace = session.workspace_id is None
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # A user with no workspace has nowhere to land. Sending them to /projects
    # would render a page that can only answer WORKSPACE_REQUIRED.
    landing = "/onboarding/workspace" if needs_workspace else "/projects"
    response = RedirectResponse(
        f"{settings.frontend_base_url}{landing}", status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,  # a random id, never a token
        httponly=True,  # JavaScript cannot read it, so XSS cannot steal it
        secure=settings.cookie_secure,
        samesite="lax",  # another website cannot make the browser send it
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
    workspace_id: uuid.UUID | None = Depends(get_optional_workspace_id),
) -> SessionOut:
    """Who is signed in, and whether they have anywhere to work yet.

    Deliberately does not depend on `get_db`: that binds a workspace, and this is
    precisely the endpoint a user with no workspace must be able to call. It opens
    its own session instead.
    """
    db = SessionLocal()
    try:
        user = db.get_one(User, user_id)
        role: str | None = None
        permissions: list[str] = []
        if workspace_id is not None:
            set_workspace_context(db, workspace_id)
            context = resolve_authorization_context(db, user_id, workspace_id)
            role = context.role_id
            permissions = sorted(context.permissions)
        return SessionOut(
            user_id=str(user_id),
            workspace_id=None if workspace_id is None else str(workspace_id),
            needs_workspace_setup=workspace_id is None,
            role=role,
            permissions=permissions,
            email=user.email,
            name=user.display_name,
            avatar_url=user.avatar_url,
            identity_provider=user.identity_provider,
        )
    finally:
        db.close()


@router.get("/workspaces", response_model=list[WorkspaceSummaryOut])
def list_workspaces(
    user_id: uuid.UUID = Depends(get_current_user_id),
    session_id: uuid.UUID = Depends(get_current_session_id),
    workspace_id: uuid.UUID | None = Depends(get_optional_workspace_id),
) -> list[WorkspaceSummaryOut]:
    """Every workspace this user may act in. Empty during onboarding."""
    db = SessionLocal()
    try:
        workspaces = auth_service.list_active_workspaces(db, session_id=session_id, user_id=user_id)
        return [
            _summary(workspace, is_active=workspace.workspace_id == workspace_id)
            for workspace in workspaces
        ]
    finally:
        db.close()


@router.post("/workspaces", response_model=WorkspaceSummaryOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    body: CreateWorkspaceIn,
    user_id: uuid.UUID = Depends(get_current_user_id),
    session_id: uuid.UUID = Depends(get_current_session_id),
    workspace_id: uuid.UUID | None = Depends(get_optional_workspace_id),
) -> WorkspaceSummaryOut:
    """Create a workspace and make it this session's active one.

    Two callers, one endpoint. During onboarding the session has no workspace and
    being authenticated is the whole check — there is no workspace in which to
    hold a permission, and refusing here would leave the user permanently unable
    to start. Afterwards it is an ordinary org-admin operation in the workspace
    they are currently in, so a developer cannot spin up workspaces at will.
    """
    db = SessionLocal()
    try:
        if workspace_id is not None:
            set_workspace_context(db, workspace_id)
            context = resolve_authorization_context(db, user_id, workspace_id)
            if "workspace:update" not in context.permissions:
                raise Forbidden
        created = auth_service.create_workspace(
            db,
            session_id=session_id,
            user_id=user_id,
            name=body.name,
            description=body.description,
            website_url=body.website_url,
        )
        if created is None:
            raise NotFound
        db.commit()
        return _summary(created, is_active=True)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceSummaryOut)
def get_workspace(
    workspace_id: uuid.UUID,
    context: Annotated[AuthorizationContext, Depends(get_authorization_context)],
    db: DbSession = Depends(get_db),
) -> WorkspaceSummaryOut:
    """The active workspace's own metadata.

    Only the active one is readable. Another workspace the user belongs to is a
    404 rather than a cross-tenant read: switch to it first, which rebinds
    row-level security, and then read it.
    """
    if workspace_id != context.workspace_id:
        raise NotFound
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound
    return _summary(
        auth_service.describe_workspace(db, workspace, context.role_id), is_active=True
    )


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceSummaryOut)
def update_workspace(
    workspace_id: uuid.UUID,
    body: UpdateWorkspaceIn,
    context: WorkspaceAdmin,
    db: DbSession = Depends(get_db),
) -> WorkspaceSummaryOut:
    """Partial metadata update. Omitted fields are left alone.

    Only the active workspace can be edited, for the same reason it is the only
    one readable: the session binds one workspace, and editing another would mean
    writing outside the tenant this transaction is isolated to.
    """
    if workspace_id != context.workspace_id:
        raise NotFound
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound

    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"] is not None:
        workspace.name = fields["name"]
    if "description" in fields:
        workspace.description = fields["description"]
    if "website_url" in fields:
        workspace.website_url = fields["website_url"]
    db.flush()
    return _summary(
        auth_service.describe_workspace(db, workspace, context.role_id), is_active=True
    )


@router.put("/workspaces/active", response_model=WorkspaceSummaryOut)
def switch_workspace(
    body: SwitchWorkspaceIn,
    user_id: uuid.UUID = Depends(get_current_user_id),
    session_id: uuid.UUID = Depends(get_current_session_id),
) -> WorkspaceSummaryOut:
    try:
        workspace_id = uuid.UUID(body.workspace_id)
    except ValueError as exc:
        raise NotFound from exc

    db = SessionLocal()
    try:
        selected = auth_service.switch_session_workspace(
            db,
            session_id=session_id,
            user_id=user_id,
            workspace_id=workspace_id,
        )
        if selected is None:
            raise NotFound
        db.commit()
        return _summary(selected, is_active=True)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


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
