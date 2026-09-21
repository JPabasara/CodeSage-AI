"""FastAPI dependencies: the database session, the caller, and the tenant context.

`get_db` binds RLS context and checks active membership for the data transaction.
Session validation does the same in its separate authentication transaction.
Every router that touches data depends on get_db; opening an unbound session
would fail or see no tenant data.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.config import get_settings
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import SessionLocal
from codesage_api.errors import NotAuthenticated
from codesage_api.services import auth as auth_service
from codesage_api.services.memberships import get_active_membership, resolve_authorization_context


def get_current_user_id(request: Request) -> uuid.UUID:
    session = SessionLocal()
    try:
        record = auth_service.load_valid_session(
            session, request.cookies.get(get_settings().session_cookie_name)
        )
        if record is None:
            # Commit before refusing. `load_valid_session` deletes the row when it
            # finds one expired, and the `except` below rolls back — which would
            # undo that delete on every single request and the row would never go.
            session.commit()
            raise NotAuthenticated
        user_id = record.user_id
        # Stashed so get_workspace_id does not have to ask the database again.
        request.state.workspace_id = record.workspace_id
        request.state.session_id = record.id
        session.commit()  # saves the slid expiry from load_valid_session
        return user_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_workspace_id(
    request: Request, user_id: Annotated[uuid.UUID, Depends(get_current_user_id)]
) -> uuid.UUID:

    return request.state.workspace_id


def get_current_session_id(
    request: Request,
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> uuid.UUID:
    return request.state.session_id


def get_db(
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> Iterator[Session]:

    session = SessionLocal()
    try:
        set_workspace_context(session, workspace_id)
        # Recheck in the actual data transaction as well as session validation.
        if get_active_membership(session, user_id, workspace_id) is None:
            raise NotAuthenticated
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_authorization_context(
    db: Annotated[Session, Depends(get_db)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> AuthorizationContext:
    """FastAPI caches this dependency only within the current request.

    The next request reads current membership and grants again. The data session
    and RLS workspace are shared with the endpoint through get_db.
    """
    return resolve_authorization_context(db, user_id, workspace_id)


def require_permission(permission: str) -> Callable[..., AuthorizationContext]:
    """Dependency factory: Depends(require_permission("scan:start")).

    For resource-specific operations, resolve visibility first and then call
    context.require_permission so inaccessible resources consistently return 404.
    """

    def check_permission(
        context: Annotated[AuthorizationContext, Depends(get_authorization_context)],
    ) -> AuthorizationContext:
        context.require_permission(permission)
        return context

    return check_permission
