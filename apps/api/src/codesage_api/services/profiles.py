from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import ScoringProfile
from codesage_api.schemas import CategoryWeights, ScoreProfileOut
from codesage_api.scoring.config_loader import Preset, get_presets
from codesage_api.scoring.enums import Category
from codesage_api.scoring.formula import clamp_profile
from codesage_api.scoring.models import Profile
from codesage_api.services import audit

# Presets live in versioned configuration (SRS SP-8), not in a workspace table.
# Stable UUIDs keep their contract identities consistent across processes/releases.
_PRESET_IDS = {
    "balanced": uuid.UUID("5f2b8c14-9d63-4a07-b1e8-3c4d5e6f7a80"),
    "security-first": uuid.UUID("6a3c9d25-0e74-4b18-c2f9-4d5e6f7a8b91"),
    "delivery-speed": uuid.UUID("7b4d0e36-1f85-4c29-d30a-5e6f7a8b9c02"),
}


def _active_row(session: Session, workspace_id: uuid.UUID) -> ScoringProfile:
    stored = session.scalar(
        select(ScoringProfile).where(
            ScoringProfile.workspace_id == workspace_id,
            ScoringProfile.is_active.is_(True),
        )
    )
    if stored is None:
        raise RuntimeError("Workspace does not have an active scoring profile.")
    return stored


def _stored_weights(stored: ScoringProfile) -> dict[Category, float]:
    return {
        Category.SECURITY: stored.security_weight,
        Category.CODE_DESIGN: stored.code_design_weight,
        Category.REQUIREMENT: stored.requirement_weight,
        Category.DOCUMENTATION: stored.documentation_weight,
        Category.TEST: stored.test_weight,
    }


def _wire_weights(weights: dict[Category, float]) -> CategoryWeights:
    return CategoryWeights(
        security=weights[Category.SECURITY],
        code_design=weights[Category.CODE_DESIGN],
        requirement=weights[Category.REQUIREMENT],
        documentation=weights[Category.DOCUMENTATION],
        test=weights[Category.TEST],
    )


def _matches_preset(stored: ScoringProfile, preset: Preset) -> bool:
    return (
        stored.name == preset.name
        and _stored_weights(stored) == preset.weights
        and stored.trust_slider == preset.s
    )


def _stored_output(stored: ScoringProfile) -> ScoreProfileOut:
    return ScoreProfileOut(
        id=str(stored.id),
        name=stored.name,
        weights=_wire_weights(_stored_weights(stored)),
        trust_s=stored.trust_slider,
        is_preset=any(
            _matches_preset(stored, preset) for preset in get_presets().values()
        ),
        is_active=stored.is_active,
    )


def get_active(session: Session, workspace_id: uuid.UUID) -> Profile:
    """Return the pure scoring input used by dashboard read paths."""
    stored = _active_row(session, workspace_id)
    return Profile(
        weights=_stored_weights(stored),
        s=stored.trust_slider,
        name=stored.name,
    )


def get_active_output(
    session: Session, workspace_id: uuid.UUID
) -> ScoreProfileOut:
    """Return the workspace profile in the public API shape."""
    return _stored_output(_active_row(session, workspace_id))


def list_available(
    session: Session, workspace_id: uuid.UUID
) -> list[ScoreProfileOut]:
    """Return the three configured presets plus the active custom profile, if any."""
    active = _active_row(session, workspace_id)
    outputs: list[ScoreProfileOut] = []
    active_matches_preset = False

    for key, preset in get_presets().items():
        matches = _matches_preset(active, preset)
        active_matches_preset = active_matches_preset or matches
        outputs.append(
            ScoreProfileOut(
                id=str(_PRESET_IDS[key]),
                name=preset.name,
                weights=_wire_weights(preset.weights),
                trust_s=preset.s,
                is_preset=True,
                is_active=matches,
            )
        )

    if not active_matches_preset:
        outputs.append(_stored_output(active))
    return outputs


def apply(
    session: Session,
    workspace_id: uuid.UUID,
    weights: dict[str, float],
    s: float,
    actor_user_id: uuid.UUID | None,
    name: str | None = None,
) -> ScoreProfileOut:
    """Clamp and replace the workspace's active profile in place (SRS FR-20)."""
    category_weights = {
        Category(key.replace("_", "-")): value for key, value in weights.items()
    }
    clamped_weights, clamped_s = clamp_profile(category_weights, s)
    stored = _active_row(session, workspace_id)

    # One update of the existing row: no analysis, snapshot, finding, or queue
    # object is referenced on this write path (SRS FR-20/FR-21, SAD section 6.2).
    stored.name = name or "Custom"
    stored.security_weight = clamped_weights[Category.SECURITY]
    stored.code_design_weight = clamped_weights[Category.CODE_DESIGN]
    stored.requirement_weight = clamped_weights[Category.REQUIREMENT]
    stored.documentation_weight = clamped_weights[Category.DOCUMENTATION]
    stored.test_weight = clamped_weights[Category.TEST]
    stored.trust_slider = clamped_s
    stored.is_active = True
    session.flush()

    audit.record(
        session,
        event_type="profile_applied",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(stored.id),
    )
    return _stored_output(stored)
