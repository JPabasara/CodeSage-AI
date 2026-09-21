from __future__ import annotations

import uuid

import httpx
import pytest

from codesage_api.config import get_settings
from codesage_api.errors import UpstreamUnavailable
from codesage_api.integrations import resend


def test_sends_invitation_without_exposing_key_in_payload(monkeypatch) -> None:
    monkeypatch.setenv("CODESAGE_RESEND_API_KEY", "re_secret")
    monkeypatch.setenv("CODESAGE_INVITATION_FROM_EMAIL", "CodeSage <invite@example.com>")
    get_settings.cache_clear()
    captured = {}

    def post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return httpx.Response(200, json={"id": "email-id"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(resend.httpx, "post", post)
    invitation_id = uuid.uuid4()
    resend.send_workspace_invitation(
        recipient="new@example.com",
        invitation_url="https://app.example.com/invitations/accept?token=secret&next=<home>",
        invitation_id=invitation_id,
    )

    assert captured["headers"]["Authorization"] == "Bearer re_secret"
    assert captured["headers"]["Idempotency-Key"] == f"workspace-invitation/{invitation_id}"
    assert captured["json"]["to"] == ["new@example.com"]
    assert "re_secret" not in str(captured["json"])
    assert "&lt;home&gt;" in captured["json"]["html"]
    get_settings.cache_clear()


def test_missing_key_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("CODESAGE_RESEND_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(UpstreamUnavailable):
        resend.send_workspace_invitation(
            recipient="new@example.com",
            invitation_url="https://app.example.com/invite?token=secret",
            invitation_id=uuid.uuid4(),
        )
    get_settings.cache_clear()


def test_resend_http_failure_is_sanitized(monkeypatch) -> None:
    monkeypatch.setenv("CODESAGE_RESEND_API_KEY", "re_secret")
    get_settings.cache_clear()

    def post(url, **_kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(429, json={"message": "provider detail"}, request=request)

    monkeypatch.setattr(resend.httpx, "post", post)
    with pytest.raises(UpstreamUnavailable):
        resend.send_workspace_invitation(
            recipient="new@example.com",
            invitation_url="https://app.example.com/invite?token=secret",
            invitation_id=uuid.uuid4(),
        )
    get_settings.cache_clear()
