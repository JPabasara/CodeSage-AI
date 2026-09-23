"""Project (repository) endpoints (SRS FR-3, FR-4)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from codesage_api.deps import get_current_user_id, get_db, get_workspace_id, require_permission
from codesage_api.schemas import ConnectRepoIn, RepoOut
from codesage_api.services import repositories

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get(
    "", response_model=list[RepoOut], dependencies=[Depends(require_permission("project:read"))]
)
def list_projects(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> list[RepoOut]:

    return repositories.list_projects(db, workspace_id)


@router.post(
    "",
    response_model=RepoOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("repository:connect"))],
)
def connect_repository(
    body: ConnectRepoIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> RepoOut:

    return repositories.connect(db, workspace_id, str(body.url), user_id)


@router.delete(
    "/{repo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("repository:disconnect"))],
)
def disconnect_repository(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> Response:
    repositories.disconnect(db, workspace_id, repo_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
