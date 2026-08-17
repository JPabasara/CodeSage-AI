"""Project (repository) endpoints (SRS FR-3, FR-4)."""

from __future__ import annotations

from fastapi import APIRouter, status

from codesage_api.schemas import ConnectRepoIn, RepoOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[RepoOut])
def list_projects() -> list[RepoOut]:
    """Connected projects with name, owner, visibility and current health (FR-4).

    The health hint is derived, like every other score. If the projects list ever
    becomes slow enough to need a cached column, that cache must be stamped with
    the profile that produced it and recomputed whenever the active profile
    differs — otherwise the list shows one grade and the dashboard another.
    """
    raise NotImplementedError


@router.post("", response_model=RepoOut, status_code=status.HTTP_201_CREATED)
def connect_repository(body: ConnectRepoIn) -> RepoOut:
    """Connect a public repository by pasted URL (FR-3).

    Validates the URL, reads name/owner/visibility/default branch from the GitHub
    REST API, and creates the project under the caller's workspace.

    **Rejects anything that is not public.** Private repositories need the GitHub
    App installation flow, which is not in v1.0 — the request fails with a message
    that says so, rather than failing later and opaquely at clone time.
    """
    raise NotImplementedError
