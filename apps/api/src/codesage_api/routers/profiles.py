from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import require_profile_permission
from codesage_api.db.rls import set_workspace_context
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id, require_permission
from codesage_api.logging import get_logger
from codesage_api.schemas import (
    CreateProfileIn,
    ScoreProfileIn,
    ScoreProfileOut,
    SelectProfileIn,
    UpdateProfileIn,
)
from codesage_api.services import profiles
from codesage_api.tasks.app import celery_app

logger = get_logger(__name__)

router = APIRouter(tags=["profiles"])


def _rescore(db: Session, workspace_id: uuid.UUID, profile_id: str) -> None:
    """Queue new cache entries for the projects this write actually affects.

    Scoring is derived on read and keyed by a profile fingerprint, so nothing here
    invalidates anything: a changed profile simply stops matching the cached rows
    and the warm-up fills the new key ahead of the next dashboard read. No scan,
    snapshot, finding or analysis attempt is created — a profile is not a commit.
    """
    try:
        celery_app.send_task(
            "codesage.warm_profile_scores", args=[str(workspace_id), profile_id]
        )
    except Exception:
        logger.exception("Could not enqueue score warm-up after a profile change")
        # The queue call runs after the commit, so the transaction is gone and
        # with it the bound workspace. Restore it for whatever runs next.
        set_workspace_context(db, workspace_id)


@router.get(
    "/profiles",
    response_model=list[ScoreProfileOut],
    dependencies=[Depends(require_permission("profile:read"))],
)
def list_profiles(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> list[ScoreProfileOut]:
    """The workspace's profile pool: three built-ins plus its own profiles."""
    return profiles.list_available(db, workspace_id)


@router.post(
    "/profiles",
    response_model=ScoreProfileOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("profile:update"))],
)
def create_profile(
    body: CreateProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:
    """Add one custom profile. The sixth is refused with PROFILE_LIMIT_REACHED."""
    return profiles.create(
        db, workspace_id, body.name, body.weights.model_dump(), body.trust_s, user_id
    )


# Declared before /profiles/{profile_id} so the literal paths win the match.
@router.get(
    "/profiles/active",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_permission("profile:read"))],
)
def get_active_profile(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScoreProfileOut:
    """Superseded by GET /profiles/default, and kept until the web moves over."""
    return profiles.get_active_output(db, workspace_id)


@router.put(
    "/profiles/active",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_permission("profile:update"))],
)
def apply_profile(
    body: ScoreProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:
    """Superseded by POST /profiles + PUT /profiles/default."""
    result = profiles.apply(
        db, workspace_id, body.weights.model_dump(), body.trust_s, user_id, body.name
    )
    db.commit()
    _rescore(db, workspace_id, result.id)
    return result


@router.get(
    "/profiles/default",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_permission("profile:read"))],
)
def get_default_profile(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScoreProfileOut:
    """The profile every project without an override scores with."""
    return profiles.get_active_output(db, workspace_id)


@router.put(
    "/profiles/default",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_permission("profile:update"))],
)
def set_default_profile(
    body: SelectProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:
    """Choose any profile from this workspace's pool as its default."""
    result = profiles.set_default(db, workspace_id, body.profile_id, user_id)
    db.commit()
    _rescore(db, workspace_id, result.id)
    return result


@router.get(
    "/profiles/{profile_id}",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_profile_permission("profile:read"))],
)
def get_profile(
    profile_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScoreProfileOut:
    return profiles.get(db, workspace_id, profile_id)


@router.patch(
    "/profiles/{profile_id}",
    response_model=ScoreProfileOut,
    dependencies=[Depends(require_profile_permission("profile:update"))],
)
def update_profile(
    profile_id: uuid.UUID,
    body: UpdateProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:
    """Partial update of a custom profile. Built-ins are refused."""
    result = profiles.update(
        db, workspace_id, profile_id, body.name, body.weights, body.trust_s, user_id
    )
    db.commit()
    _rescore(db, workspace_id, result.id)
    return result


@router.delete(
    "/profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_profile_permission("profile:update"))],
)
def delete_profile(
    profile_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> Response:
    """Delete an unused custom profile. Built-ins and in-use profiles are refused."""
    profiles.delete(db, workspace_id, profile_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
