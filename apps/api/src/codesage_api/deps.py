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
   
    return request.state.workspace_id


def get_db(workspace_id: uuid.UUID = Depends(get_workspace_id)) -> Iterator[Session]:
  
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
