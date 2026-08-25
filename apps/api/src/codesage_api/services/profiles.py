from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import ScoringProfile
from codesage_api.scoring.models import Profile
from codesage_api.scoring.enums import Category

def get_active(
    session: Session,
    workspace_id: uuid.UUID,
) -> Profile:
    statement = select(ScoringProfile).where(
        ScoringProfile.workspace_id == workspace_id,
        ScoringProfile.is_active.is_(True),
    )

    stored_profile = session.execute(
        statement
    ).scalar_one_or_none()

    if stored_profile is None:
        raise RuntimeError(
            "Workspace does not have an active scoring profile."
        )

    return Profile(
        weights={
            Category.SECURITY:
                stored_profile.security_weight,
            Category.CODE_DESIGN:
                stored_profile.code_design_weight,
            Category.REQUIREMENT:
                stored_profile.requirement_weight,
            Category.DOCUMENTATION:
                stored_profile.documentation_weight,
            Category.TEST:
                stored_profile.test_weight,
        },
        s=stored_profile.trust_slider,
        name=stored_profile.name,
    )


def apply(
    session: Session,
    workspace_id: uuid.UUID,
    weights: dict[str, float],
    s: float,
    actor_user_id: uuid.UUID | None,
) -> ScoringProfile:
    """Clamp, store, activate — in one transaction.

    **This is the only place clamping happens.** `formula.clamp_profile` holds the
    arithmetic and `calibration.yaml` holds the bounds, but this is the single
    call site on the write path. Putting a second clamp in the router or the
    repository would mean two implementations that drift.

    Clamps silently and returns what was stored rather than rejecting an
    out-of-range value, because FR-20 requires the client to be able to render the
    corrected value instead of believing its own.

    Writes the new SCORING_PROFILE and clears the previous active flag in one
    transaction, so no reader can ever see two active profiles or none. The
    partial unique index on the table makes that a guarantee rather than a
    convention (locked decision 11). Records the actor and modification time per
    DBR-19.

    **What this function must never do:** enqueue anything, touch a Snapshot,
    Finding or SourceFile row, or trigger a scan. A snapshot is keyed by commit
    SHA and a profile is not a commit — writing one here would put a step on the
    trend chart on a day nobody changed the code.
    """
    raise NotImplementedError
