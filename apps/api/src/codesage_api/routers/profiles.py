from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from codesage_api.db.rls import set_workspace_context
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.logging import get_logger
from codesage_api.schemas import ScoreProfileIn, ScoreProfileOut
from codesage_api.services import profiles
from codesage_api.tasks.app import celery_app

logger = get_logger(__name__)

router = APIRouter(tags=["profiles"])


@router.get("/profiles", response_model=list[ScoreProfileOut])
def list_profiles(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> list[ScoreProfileOut]:
    """The three presets that seed the sliders"""
    return profiles.list_available(db, workspace_id)


@router.get("/profiles/active", response_model=ScoreProfileOut)
def get_active_profile(
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> ScoreProfileOut:
 
    return profiles.get_active_output(db, workspace_id)


@router.put("/profiles/active", response_model=ScoreProfileOut)
def apply_profile(
    body: ScoreProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:

    result = profiles.apply(
        db,
        workspace_id,
        body.weights.model_dump(),
        body.trust_s,
        user_id,
        body.name,
    )
    db.commit()
    try:
        celery_app.send_task(
            "codesage.warm_workspace_scores", args=[str(workspace_id)]
        )
    except Exception:
        logger.exception("Could not enqueue score warm-up after profile change")
        set_workspace_context(db, workspace_id)
    return result
