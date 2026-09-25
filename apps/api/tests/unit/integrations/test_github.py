"""GitHub metadata read at connect time (13H.1: size and languages)."""

from __future__ import annotations

import httpx
import pytest

from codesage_api.errors import RateLimited, UpstreamUnavailable
from codesage_api.integrations import github

REPOSITORY = {
    "id": 42,
    "name": "widget",
    "owner": {"login": "acme"},
    "html_url": "https://github.com/acme/widget",
    "private": False,
    "visibility": "public",
    "default_branch": "main",
    "size": 12_345,
}


def _serve(monkeypatch, languages: httpx.Response) -> list[str]:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        if request.url.path == "/repos/acme/widget":
            return httpx.Response(200, json=REPOSITORY)
        if request.url.path == "/repos/acme/widget/branches/main":
            return httpx.Response(200, json={"name": "main", "commit": {"sha": "a" * 40}})
        if request.url.path == "/repos/acme/widget/languages":
            return languages
        return httpx.Response(404)

    real_client = httpx.Client

    def client(**kwargs) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(github.httpx, "Client", client)
    return requested


def test_size_and_languages_come_back_with_the_metadata(monkeypatch) -> None:
    # GitHub's order is not a promise; most bytes first is.
    _serve(monkeypatch, httpx.Response(200, json={"Shell": 10, "Java": 9000, "Kotlin": 300}))

    metadata = github.fetch_repository("https://github.com/acme/widget")

    assert metadata.size_kb == 12_345
    assert metadata.languages == ("Java", "Kotlin", "Shell")


def test_an_empty_repository_has_no_languages(monkeypatch) -> None:
    _serve(monkeypatch, httpx.Response(200, json={}))

    assert github.fetch_repository("https://github.com/acme/widget").languages == ()


def test_the_languages_call_reports_a_rate_limit_as_a_rate_limit(monkeypatch) -> None:
    _serve(
        monkeypatch,
        httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={}),
    )

    with pytest.raises(RateLimited):
        github.fetch_repository("https://github.com/acme/widget")


def test_the_languages_call_reports_a_github_outage_as_one(monkeypatch) -> None:
    _serve(monkeypatch, httpx.Response(502))

    with pytest.raises(UpstreamUnavailable):
        github.fetch_repository("https://github.com/acme/widget")
