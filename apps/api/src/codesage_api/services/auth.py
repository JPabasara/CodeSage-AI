"""AuthenticationService — GitHub OAuth, sessions, sign-out (FR-1, SEC-01, SEC-10).

Stateless: the session is a signed cookie, so no server-side session store is
needed and any API replica can serve any request.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import User


def begin_authorization() -> str:
    """Build the GitHub authorization URL with scopes and a signed `state` nonce."""
    raise NotImplementedError


def complete_authorization(session: Session, code: str, state: str) -> tuple[User, uuid.UUID]:
    """Verify `state`, exchange the code, upsert the user, return (user, workspace_id).

    On first sign-in this provisions the tenant: creates the Workspace, the
    Membership, and the initial ScoringProfile seeded from the Balanced preset and
    set as active. Doing it here means `active_profile_id` is never null and the
    read path never needs a fallback.

    The GitHub access token is used for this exchange and then discarded. It is not
    persisted: v1.0 clones public repositories anonymously, so there is nothing a
    stored token would buy — and PRI-02 keeps credentials inside backend services.
    """
    raise NotImplementedError


def resolve_workspace(session: Session, user_id: uuid.UUID) -> uuid.UUID:
    """The caller's workspace — the value bound into the RLS context on every request.

    v1.0 has exactly one workspace per user (DBR-4). The lookup goes through
    MEMBERSHIP rather than a column on USER so that v2's multi-workspace membership
    is a query change, not a migration.
    """
    raise NotImplementedError
