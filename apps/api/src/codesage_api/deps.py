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

from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import SessionLocal


def get_current_user_id(request: Request) -> uuid.UUID:
    """The signed-in user from the session cookie, or 401.

    Stateless: the cookie is signed and self-contained, so no session store is
    needed and any API replica can serve any request.
    """
    raise NotImplementedError


def get_workspace_id(user_id: uuid.UUID = Depends(get_current_user_id)) -> uuid.UUID:
    """The caller's workspace. v1.0: exactly one per user."""
    raise NotImplementedError


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
