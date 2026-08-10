"""SCORING_PROFILE and SCORING_PRESET queries."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import ScoringPreset, ScoringProfile
from codesage_api.scoring.models import Profile


def list_presets(session: Session) -> list[ScoringPreset]:
    """The three presets that seed the sliders (GET /api/profiles, FR-20)."""
    raise NotImplementedError


def get_active(session: Session, workspace_id: uuid.UUID) -> Profile:
    """Resolve the workspace's active profile into scoring's value type.

    Every read endpoint calls this. It is why `GET /api/repos/{id}/health?branch=`
    carries no profile parameter and looks identical before and after a profile
    change: the lens is server-side state belonging to the workspace, not something
    the client passes (FR-20). Were it a query parameter, a custom slider setting
    with no name would have to travel as six parameters on every read, putting the
    scoring formula's shape into every URL in the product.

    Falls back to the Balanced preset if active_profile_id is null.
    """
    raise NotImplementedError


def get_active_row(session: Session, workspace_id: uuid.UUID) -> ScoringProfile | None:
    """The ORM row behind the active profile, for GET /api/profiles/active, which
    returns the stored representation rather than the scoring value type."""
    raise NotImplementedError


def upsert_active(
    session: Session,
    workspace_id: uuid.UUID,
    weights: dict[str, float],
    trust_s: float,
    updated_by_user_id: uuid.UUID | None,
) -> ScoringProfile:
    """Write the profile and point WORKSPACE.active_profile_id at it.

    Both halves in ONE transaction, so no reader can observe one without the other
    (DBR-25). A workspace whose active_profile_id pointed at a half-written row
    would mis-score every dashboard until someone noticed.

    Values must already be clamped by `services.profiles`. This layer does not
    clamp; if it did, the clamp would live in two places and drift.
    """
    raise NotImplementedError


def seed_for_workspace(session: Session, workspace_id: uuid.UUID) -> ScoringProfile:
    """Create the workspace's initial profile from the Balanced preset and activate it.

    Called once, at workspace creation, so active_profile_id is never null in
    practice and the read path never has to fall back.
    """
    raise NotImplementedError
