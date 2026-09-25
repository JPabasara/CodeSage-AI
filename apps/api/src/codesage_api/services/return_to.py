"""Where sign-in may send the browser afterwards.

`return_to` arrives in a URL anyone can craft, and the callback turns it into a
redirect, so it is the classic open-redirect input. It is accepted only when it
is a plain relative path on this allowlist, and it is then appended to
`frontend_base_url`, so the host can never change.
"""

from __future__ import annotations

from urllib.parse import unquote, urlsplit

#: Exact paths, plus everything under /dashboard/.
ALLOWED_PATHS = frozenset(
    {"/invitations/accept", "/projects", "/dashboard", "/profiles", "/workspace"}
)
ALLOWED_PREFIXES = ("/dashboard/",)
MAX_LENGTH = 2048


def safe_return_to(value: str | None) -> str | None:
    """The same value when it is safe to redirect to, otherwise None."""
    if not value or len(value) > MAX_LENGTH:
        return None
    # One leading slash and nothing a browser might read as a host: `//evil`,
    # `/\\evil` and a smuggled scheme or control character are all refused.
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return None
    if any(ord(character) < 0x21 or ord(character) == 0x7F for character in value):
        return None

    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return None

    # Judge the decoded path, so `%2F%2F` or `%2e%2e` cannot slip past.
    decoded = unquote(parts.path)
    if "//" in decoded or "\\" in decoded or ".." in decoded.split("/"):
        return None
    if decoded not in ALLOWED_PATHS and not decoded.startswith(ALLOWED_PREFIXES):
        return None

    # The fragment never reaches a server anyway; drop it rather than carry it.
    return parts.path + (f"?{parts.query}" if parts.query else "")
