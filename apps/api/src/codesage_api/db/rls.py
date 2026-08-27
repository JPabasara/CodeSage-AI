from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session


def set_workspace_context(session: Session, workspace_id: uuid.UUID) -> None:
    """Bind the tenant for the current transaction"""

    session.execute(
        text("SELECT set_config('app.current_workspace_id', :wid, true)"),
        {"wid": str(workspace_id)},
    )
