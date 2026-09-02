"""Project (repository) endpoints (SRS FR-3, FR-4)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.schemas import ConnectRepoIn, RepoOut
from codesage_api.services import repositories

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[RepoOut])
def list_projects(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> list[RepoOut]:

    return repositories.list_projects(db, workspace_id)


@router.post("", response_model=RepoOut, status_code=status.HTTP_201_CREATED)
def connect_repository(
    body: ConnectRepoIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> RepoOut:

    return repositories.connect(db, workspace_id, str(body.url), user_id)
