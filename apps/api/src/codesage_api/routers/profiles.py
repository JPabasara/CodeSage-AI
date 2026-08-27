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
    """The workspace's active profile — five weights and the trust slider.

    Seeds the Profiles screen on load, so the sliders open at the values actually
    in force rather than at a client-side guess.
    """
    return profiles.get_active_output(db, workspace_id)


@router.put("/profiles/active", response_model=ScoreProfileOut)
def apply_profile(
    body: ScoreProfileIn,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
) -> ScoreProfileOut:
    """Apply a profile. One idempotent write carrying the COMPLETE profile.

    What the handler does, in full:

    1. **Clamp** every weight to 0.1–3.0 and `s` to 0–1. Server-side even though
       the sliders already cannot exceed it: the sliders are a UI affordance, the
       clamp is the invariant. `repo_health` is calibrated against `k`, so one
       unclamped weight from any client would make every stored grade incomparable
       with every other. Clamp silently rather than rejecting.
    2. **Write** SCORING_PROFILE and mark it the active one, in a single
       transaction. Six numbers. No queue, no worker, no clone, no Snapshot.
       "Exactly one active profile per workspace" is held by a partial unique
       index on the table, so it is a fact the database enforces rather than a
       rule this handler has to remember (locked decision 11).
    3. **Return the stored profile**, so the client renders what was really saved
       instead of believing its own values — a client that sent 5.0 must display
       the 3.0 that is actually in force.

    The client then re-issues its ordinary read, `GET /api/repos/{id}/health?
    branch=`, which carries no profile parameter and resolves the active profile
    itself.

    **Why PUT and not PATCH.** The body is the complete profile, not a delta, so
    applying it twice is applying it once. That matters because the client fires a
    dependent read immediately afterwards: a retry on a dropped response must not
    leave three weights updated and two not, which would render a dashboard
    matching no profile the system holds.
    """
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
