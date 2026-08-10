"""GitHub OAuth sign-in (SRS FR-1, SEC-01, SEC-10).

v1.0 uses OAuth for *identity only*. It establishes who the user is and which
workspace they own; it does not obtain repository access, because the analysis
pipeline clones public repositories anonymously. There is no GitHub App
installation and no private-repository authorization in v1.0.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/github")
def begin_sign_in() -> RedirectResponse:
    """Redirect to GitHub's authorization page with the scopes and a `state` value.

    `state` is a signed, single-use nonce checked on return — without it the
    callback would accept an authorization code from anywhere, which is CSRF on
    the sign-in flow.
    """
    raise NotImplementedError


@router.get("/github/login")
def oauth_redirect_target(code: str, state: str) -> RedirectResponse:
    """GitHub's redirect target: exchange the code, establish the session, redirect.

    On first sign-in this also creates the user's Workspace, its Membership, and
    seeds the Balanced profile as active — so `active_profile_id` is never null and
    the read path never has to fall back.

    Writes a SecurityAuditRecord for both success and failure. A failed sign-in has
    no established actor, which is exactly the event most worth recording.
    """
    raise NotImplementedError


@router.get("/github/callback")
def current_user() -> dict:
    """Return the signed-in user, or 401 if there is no valid session."""
    raise NotImplementedError


@router.post("/session")
def sign_out() -> None:
    """End the session and invalidate its credentials (SEC-10)."""
    raise NotImplementedError
