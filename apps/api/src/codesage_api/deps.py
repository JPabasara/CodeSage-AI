"""FastAPI dependencies: the database session, the caller, and the tenant context.

`get_db` is the single place the RLS context is established for a request. Every
router that touches data depends on it — a handler that opened its own session
would run with no tenant bound and, depending on how the policy is written, either
error or silently see nothing.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from codesage_api.config import get_settings
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import SessionLocal
from codesage_api.errors import NotAuthenticated
from codesage_api.services import auth as auth_service


def get_current_user_id(request: Request) -> uuid.UUID:
    """Who is calling? Read the cookie, look up the row, or refuse.

    Opens its own short database connection rather than using `get_db`, because
    `get_db` needs to know the workspace and the workspace is exactly what this
    function is here to find out. The `session` table is the one table with no
    workspace filter on it, for that reason.
    """
    session = SessionLocal()
    try:
        record = auth_service.load_valid_session(
            session, request.cookies.get(get_settings().session_cookie_name)
        )
        if record is None:
            raise NotAuthenticated
        user_id = record.user_id
        # Stashed so get_workspace_id does not have to ask the database again.
        request.state.workspace_id = record.workspace_id
        session.commit()  # saves the slid expiry from load_valid_session
        return user_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_workspace_id(
    request: Request, user_id: uuid.UUID = Depends(get_current_user_id)
) -> uuid.UUID:
    """The workspace every query in this request is limited to.

    Already known — the session row named it. Kept as its own dependency because
    `get_db` depends on it, and that dependency is what makes it impossible to
    write a handler that runs with no tenant attached.
    """
    return request.state.workspace_id


def get_db(workspace_id: uuid.UUID = Depends(get_workspace_id)) -> Iterator[Session]:
    """A request-scoped session with the tenant bound for the transaction.

    `SET LOCAL` scopes the setting to this transaction, so it cannot leak across a
    pooled connection and hand the next request someone else's tenant. A plain
    `SET` would persist on the connection and do exactly that.

    The session commits on success and rolls back on any exception, so a handler
    that raises never leaves a half-applied write.
    """
    session = SessionLocal()
    try:
        set_workspace_context(session, workspace_id)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
