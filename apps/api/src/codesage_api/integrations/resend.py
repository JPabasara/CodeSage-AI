"""Minimal Resend adapter for transactional workspace invitations."""

from __future__ import annotations

import html
import uuid

import httpx

from codesage_api.config import get_settings
from codesage_api.errors import UpstreamUnavailable

_EMAILS_URL = "https://api.resend.com/emails"


def send_workspace_invitation(
    *, recipient: str, invitation_url: str, invitation_id: uuid.UUID
) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        raise UpstreamUnavailable

    safe_url = html.escape(invitation_url, quote=True)
    try:
        response = httpx.post(
            _EMAILS_URL,
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Idempotency-Key": f"workspace-invitation/{invitation_id}",
            },
            json={
                "from": settings.invitation_from_email,
                "to": [recipient],
                "subject": "You have been invited to CodeSage",
                "html": (
                    "<p>You have been invited to join a CodeSage workspace.</p>"
                    f'<p><a href="{safe_url}">Accept invitation</a></p>'
                    f"<p>Or copy this link: {safe_url}</p>"
                ),
                "text": (
                    "You have been invited to join a CodeSage workspace.\n\n"
                    f"Accept the invitation: {invitation_url}"
                ),
                "tags": [{"name": "category", "value": "workspace_invitation"}],
            },
            timeout=settings.email_timeout_seconds,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstreamUnavailable from exc
