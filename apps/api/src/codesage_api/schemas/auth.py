"""What `GET /api/auth/session` returns.

Carries no token and no password. Those never leave this server (SEC-09).
"""

from __future__ import annotations

from codesage_api.schemas.base import ApiModel


class SessionOut(ApiModel):
    """The signed-in user.

    Only the two identifiers are guaranteed. `user_id` and `workspace_id` are
    ours, generated at first sign-in, so they always exist.

    Everything else comes from the identity provider and may simply be absent —
    a GitHub account can keep its email private and need never set a display
    name. Identity here is `asgardeo_sub` and nothing else, so a missing display
    name is a cosmetic gap, not a failed sign-in. Requiring it would turn one
    into the other: the user signs in successfully and then this endpoint returns
    500 because its own response model rejects the answer.
    """

    user_id: str
    workspace_id: str

    # Display only. Render a fallback rather than assuming these are present.
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    identity_provider: str | None = None
