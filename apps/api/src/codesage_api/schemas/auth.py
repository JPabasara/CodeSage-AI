"""What `GET /api/auth/session` returns.

Carries no token and no password. Those never leave this server (SEC-09).
"""

from __future__ import annotations

from codesage_api.schemas.base import CamelModel


class SessionOut(CamelModel):
    user_id: str
    email: str
    name: str
    avatar_url: str | None = None
    workspace_id: str
    identity_provider: str | None = None
