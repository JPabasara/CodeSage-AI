"""ScoringProfileService — apply and resolve profiles (SRS FR-20).

The whole write path for a profile change lives here, and it is six numbers.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import ScoringProfile
from codesage_api.scoring.models import Profile


def get_active(session: Session, workspace_id: uuid.UUID) -> Profile:
    """Resolve the active profile for the read path."""
    raise NotImplementedError


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

    Writes SCORING_PROFILE and WORKSPACE.active_profile_id together so no reader
    can observe one without the other, and records the actor and modification time
    per DBR-19.

    **What this function must never do:** enqueue anything, touch a Snapshot,
    Finding or SourceFile row, or trigger a scan. A snapshot is keyed by commit
    SHA and a profile is not a commit — writing one here would put a step on the
    trend chart on a day nobody changed the code.
    """
    raise NotImplementedError
