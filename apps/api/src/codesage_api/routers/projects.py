"""Project (repository) endpoints (SRS FR-3, FR-4)."""

from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session 

from codesage_api.deps import get_db, get_workspace_id 
from codesage_api.schemas import ConnectRepoIn, RepoOut
from codesage_api.services import repositories as repository_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[RepoOut])
def list_projects(
    db: Session = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_workspace_id)) -> list[RepoOut]:

    """Return repositories belonging to the caller's workspace."""
    return repository_service.list_projects(db, workspace_id)


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
