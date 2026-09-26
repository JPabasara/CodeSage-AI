"""`return_to` is redirect input from a URL anyone can craft: allowlist only."""

from __future__ import annotations

import pytest

from codesage_api.services.return_to import safe_return_to


@pytest.mark.parametrize(
    "value",
    [
        "/invitations/accept?token=abc123",
        "/invitations/accept",
        "/projects",
        "/dashboard",
        "/dashboard/1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7",
        "/dashboard/1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7/history?branch=main",
        "/profiles",
        "/workspace",
    ],
)
def test_allowed_paths_are_kept(value: str) -> None:
    assert safe_return_to(value) == value


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        # Other hosts, however they are spelled.
        "https://evil.example/invitations/accept",
        "//evil.example/projects",
        "///evil.example/projects",
        "/\\evil.example/projects",
        "\\\\evil.example",
        "javascript:alert(1)",
        "http:/projects",
        # Encoded tricks, judged after decoding.
        "/%2F%2Fevil.example",
        "/dashboard/%2e%2e/%2e%2e/admin",
        "/dashboard/../admin",
        # Whitespace and control characters some browsers strip before parsing.
        " /projects",
        "/projects\t",
        "/pro\njects",
        # Relative, or simply not on the list.
        "projects",
        "/",
        "/login",
        "/api/auth/logout",
        "/projectsX",
        "/invitations/accept/../../login",
        # Absurdly long.
        "/projects?" + "a" * 3000,
    ],
)
def test_everything_else_is_refused(value: str | None) -> None:
    assert safe_return_to(value) is None


def test_a_fragment_is_dropped() -> None:
    assert safe_return_to("/projects#top") == "/projects"
