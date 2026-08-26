from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote, urlparse

import httpx

from codesage_api.config import get_settings
from codesage_api.errors import (
    NotFound,
    RateLimited,
    RepositoryNotPublic,
    RepositoryUnreachable,
    UpstreamUnavailable,
)


@dataclass(frozen=True)
class GitHubBranch:
    name: str
    head_commit_sha: str



@dataclass(frozen=True)
class GitHubRepository:
    external_id: str
    name: str
    owner: str
    url: str
    visibility: str
    default_branch: str
    default_branch_sha: str


def parse_github_url(url: str) -> tuple[str, str]:
    parsed = urlparse(url)

    if parsed.scheme != "https" or parsed.hostname != "github.com":
        raise RepositoryUnreachable

    parts = [part for part in parsed.path.split("/") if part]

    if len(parts) != 2:
        raise RepositoryUnreachable

    owner, repository = parts
    repository = repository.removesuffix(".git")

    if not owner or not repository:
        raise RepositoryUnreachable

    return owner, repository


def fetch_repository(url: str) -> GitHubRepository:
    owner, repository_name = parse_github_url(url)
    settings = get_settings()

    headers =  {
    "Accept": "application/vnd.github+json",
    "User-Agent": "CodeSage-AI",
    "X-GitHub-Api-Version": "2022-11-28",

    }

    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    try:
       with httpx.Client(
            base_url="https://api.github.com",
            timeout=10.0,
            headers=headers,
        ) as client:
            response = client.get(
                f"/repos/{quote(owner)}/{quote(repository_name)}"
            )

            if response.status_code == 429 or (
                        response.status_code == 403
                        and response.headers.get("x-ratelimit-remaining") == "0"
                ):
                        raise RateLimited

            elif response.status_code == 404:
                raise RepositoryUnreachable

            elif response.status_code >= 500:
                raise UpstreamUnavailable

            response.raise_for_status()
            data = response.json()

            if data["private"] or data["visibility"] != "public":
                raise RepositoryNotPublic

            default_branch = data["default_branch"]

            branch_response = client.get(
                f"/repos/{quote(owner)}/{quote(repository_name)}"
                f"/branches/{quote(default_branch, safe='')}"
            )
            if branch_response.status_code == 404:
                raise RepositoryUnreachable

            elif branch_response.status_code >= 500:
                raise UpstreamUnavailable

            branch_response.raise_for_status()
            branch_data = branch_response.json()

    except (
        httpx.TimeoutException,
        httpx.NetworkError,
    ) as exc:
        raise UpstreamUnavailable from exc
    except httpx.HTTPStatusError as exc:
        raise RepositoryUnreachable from exc

    return GitHubRepository(
        external_id=str(data["id"]),
        name=data["name"],
        owner=data["owner"]["login"],
        url=data["html_url"],
        visibility=data["visibility"],
        default_branch=default_branch,
        default_branch_sha=branch_data["commit"]["sha"],
    )


def fetch_branches(owner: str, repository_name: str) -> list[GitHubBranch]:
    settings = get_settings()

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CodeSage-AI",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    branches: list[GitHubBranch] = []
    page = 1

    try:
        with httpx.Client(
            base_url="https://api.github.com",
            timeout=10.0,
            headers=headers,
        ) as client:
            while True:
                response = client.get(
                    (
                        f"/repos/{quote(owner, safe='')}/"
                        f"{quote(repository_name, safe='')}/branches"
                    ),
                    params={"per_page": 100, "page": page},
                )

                if response.status_code == 429 or (
                    response.status_code == 403
                    and response.headers.get("x-ratelimit-remaining") == "0"
                ):
                    raise RateLimited

                if response.status_code == 404:
                    raise RepositoryUnreachable

                if response.status_code >= 500:
                    raise UpstreamUnavailable

                response.raise_for_status()
                data = response.json()

                branches.extend(
                    GitHubBranch(
                        name=item["name"],
                        head_commit_sha=item["commit"]["sha"],
                    )
                    for item in data
                )

                if len(data) < 100:
                    break

                page += 1

    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        raise UpstreamUnavailable from exc
    except httpx.HTTPStatusError as exc:
        raise RepositoryUnreachable from exc

    return branches


def fetch_branch(
    owner: str,
    repository_name: str,
    branch_name: str,
) -> GitHubBranch:
    """Read one branch head for the scan skip decision."""
    settings = get_settings()
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CodeSage-AI",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    try:
        with httpx.Client(
            base_url="https://api.github.com", timeout=10.0, headers=headers
        ) as client:
            response = client.get(
                f"/repos/{quote(owner, safe='')}/"
                f"{quote(repository_name, safe='')}/branches/"
                f"{quote(branch_name, safe='')}"
            )
            if response.status_code == 429 or (
                response.status_code == 403
                and response.headers.get("x-ratelimit-remaining") == "0"
            ):
                raise RateLimited
            if response.status_code == 404:
                raise NotFound
            if response.status_code >= 500:
                raise UpstreamUnavailable
            response.raise_for_status()
            data = response.json()
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        raise UpstreamUnavailable from exc
    except httpx.HTTPStatusError as exc:
        raise RepositoryUnreachable from exc

    return GitHubBranch(
        name=data["name"], head_commit_sha=data["commit"]["sha"]
    )
