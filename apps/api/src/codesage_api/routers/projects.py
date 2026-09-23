"""Project (repository) endpoints (SRS FR-3, FR-4)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import require_repository_permission
from codesage_api.db.rls import set_workspace_context
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id, require_permission
from codesage_api.logging import get_logger
from codesage_api.schemas import ConnectRepoIn, ProjectProfileOut, RepoOut, SelectProfileIn
from codesage_api.services import profiles, repositories
from codesage_api.tasks.app import celery_app

logger = get_logger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


def _rescore(db: Session, workspace_id: uuid.UUID, profile_id: str) -> None:
    """Queue the scores this project now needs under its new profile.

    Only this project is affected, and only its cache: no scan, snapshot,
    finding or analysis attempt is created by choosing a profile.
    """
    try:
        celery_app.send_task(
            "codesage.warm_profile_scores", args=[str(workspace_id), profile_id]
        )
    except Exception:
        logger.exception("Could not enqueue score warm-up after a profile change")
        set_workspace_context(db, workspace_id)


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
    dependencies=[Depends(require_repository_permission("repository:disconnect"))],
)
def disconnect_repository(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> Response:
    repositories.disconnect(db, workspace_id, repo_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── the project's effective scoring profile ─────────────────────────────────
# All three resolve the repository before the operation permission, so a project
# from another workspace is a 404 for every role rather than a 403 that would
# confirm it exists.


@router.get(
    "/{repo_id}/profile",
    response_model=ProjectProfileOut,
    dependencies=[Depends(require_repository_permission("profile:read"))],
)
def get_project_profile(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ProjectProfileOut:
    """What this project scores with, and whether that is inherited or chosen."""
    return profiles.get_project_profile(db, workspace_id, repo_id)


@router.put(
    "/{repo_id}/profile",
    response_model=ProjectProfileOut,
    dependencies=[Depends(require_repository_permission("profile:update"))],
)
def set_project_profile(
    repo_id: uuid.UUID,
    body: SelectProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ProjectProfileOut:
    """Override the workspace default for this project alone. Idempotent."""
    result = profiles.assign_project(db, workspace_id, repo_id, body.profile_id, user_id)
    db.commit()
    _rescore(db, workspace_id, result.effective.id)
    return result


@router.delete(
    "/{repo_id}/profile",
    response_model=ProjectProfileOut,
    dependencies=[Depends(require_repository_permission("profile:update"))],
)
def clear_project_profile(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ProjectProfileOut:
    """Drop the override and go back to inheriting the workspace default."""
    result = profiles.clear_project(db, workspace_id, repo_id, user_id)
    db.commit()
    _rescore(db, workspace_id, result.effective.id)
    return result
