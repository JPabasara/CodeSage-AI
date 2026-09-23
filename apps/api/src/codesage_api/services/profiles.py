from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.enums import ScoringPresetType, ScoringProfileKind
from codesage_api.db.models import ScoringProfile, WorkspaceProfileSettings
from codesage_api.schemas import CategoryWeights, ScoreProfileOut
from codesage_api.scoring.config_loader import get_presets
from codesage_api.scoring.enums import Category
from codesage_api.scoring.formula import clamp_profile
from codesage_api.scoring.models import Profile
from codesage_api.services import audit

# presets.yaml keys to the stored preset key. The YAML seeds a workspace's three
# built-in rows once, at creation; from then on the rows are what the workspace
# scores with, so later edits to the YAML cannot silently re-score old scans.
PRESET_KEYS = {
    "balanced": ScoringPresetType.BALANCED,
    "security-first": ScoringPresetType.SECURITY_FIRST,
    "delivery-speed": ScoringPresetType.DELIVERY_SPEED,
}
# The order built-ins are offered in, ahead of the workspace's custom profiles.
_BUILT_IN_ORDER = {
    ScoringPresetType.BALANCED: 0,
    ScoringPresetType.SECURITY_FIRST: 1,
    ScoringPresetType.DELIVERY_SPEED: 2,
}


@dataclass(frozen=True, slots=True)
class Pool:
    """One workspace's profiles and the pointer saying which is in force."""

    settings: WorkspaceProfileSettings
    profiles: tuple[ScoringProfile, ...]

    @property
    def default(self) -> ScoringProfile:
        for profile in self.profiles:
            if profile.id == self.settings.default_scoring_profile_id:
                return profile
        raise RuntimeError("Workspace default scoring profile is missing from its pool.")

    @property
    def custom(self) -> tuple[ScoringProfile, ...]:
        return tuple(
            item for item in self.profiles if item.kind is ScoringProfileKind.CUSTOM
        )


def _load_pool(session: Session, workspace_id: uuid.UUID) -> Pool:
    settings = session.get(WorkspaceProfileSettings, workspace_id)
    if settings is None:
        raise RuntimeError("Workspace does not have a scoring profile pool.")
    stored = session.scalars(
        select(ScoringProfile).where(ScoringProfile.workspace_id == workspace_id)
    ).all()
    return Pool(settings=settings, profiles=tuple(stored))


def _order_key(profile: ScoringProfile) -> tuple[int, int, str]:
    if profile.kind is ScoringProfileKind.BUILT_IN and profile.preset_key is not None:
        return (0, _BUILT_IN_ORDER.get(profile.preset_key, 9), "")
    return (1, 0, profile.name.strip().lower())


def _stored_weights(stored: ScoringProfile) -> dict[Category, float]:
    return {
        Category.SECURITY: stored.security_weight,
        Category.CODE_DESIGN: stored.code_design_weight,
        Category.REQUIREMENT: stored.requirement_weight,
        Category.DOCUMENTATION: stored.documentation_weight,
        Category.TEST: stored.test_weight,
    }


def _write_weights(
    stored: ScoringProfile, weights: dict[Category, float], trust_s: float
) -> None:
    stored.security_weight = weights[Category.SECURITY]
    stored.code_design_weight = weights[Category.CODE_DESIGN]
    stored.requirement_weight = weights[Category.REQUIREMENT]
    stored.documentation_weight = weights[Category.DOCUMENTATION]
    stored.test_weight = weights[Category.TEST]
    stored.trust_slider = trust_s


def _wire_weights(weights: dict[Category, float]) -> CategoryWeights:
    return CategoryWeights(
        security=weights[Category.SECURITY],
        code_design=weights[Category.CODE_DESIGN],
        requirement=weights[Category.REQUIREMENT],
        documentation=weights[Category.DOCUMENTATION],
        test=weights[Category.TEST],
    )


def _stored_output(stored: ScoringProfile, default_id: uuid.UUID) -> ScoreProfileOut:
    return ScoreProfileOut(
        id=str(stored.id),
        name=stored.name,
        weights=_wire_weights(_stored_weights(stored)),
        trust_s=stored.trust_slider,
        is_preset=stored.kind is ScoringProfileKind.BUILT_IN,
        is_active=stored.id == default_id,
    )


def seed_workspace_profiles(
    session: Session,
    workspace_id: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    """Give a brand-new workspace its three built-ins and a Balanced default.

    Ids are generated here rather than waiting for a flush, so the settings row
    can point at Balanced in the same unit of work that creates it.
    """
    created: dict[str, ScoringProfile] = {}
    for key, preset in get_presets().items():
        preset_key = PRESET_KEYS.get(key)
        if preset_key is None:
            raise RuntimeError(f"presets.yaml defines an unknown preset {key!r}.")
        profile = ScoringProfile(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            kind=ScoringProfileKind.BUILT_IN,
            preset_key=preset_key,
            name=preset.name,
        )
        _write_weights(profile, preset.weights, preset.s)
        session.add(profile)
        created[key] = profile

    balanced = created.get("balanced")
    if balanced is None:
        raise RuntimeError("presets.yaml no longer defines the Balanced preset.")
    session.add(
        WorkspaceProfileSettings(
            workspace_id=workspace_id,
            default_scoring_profile_id=balanced.id,
            updated_by_user_id=actor_user_id,
        )
    )


def get_active(session: Session, workspace_id: uuid.UUID) -> Profile:
    """The workspace default, as the pure scoring input read paths need."""
    stored = _load_pool(session, workspace_id).default
    return Profile(
        weights=_stored_weights(stored),
        s=stored.trust_slider,
        name=stored.name,
    )


def get_active_output(session: Session, workspace_id: uuid.UUID) -> ScoreProfileOut:
    """The workspace default in the public API shape."""
    pool = _load_pool(session, workspace_id)
    return _stored_output(pool.default, pool.settings.default_scoring_profile_id)


def list_available(session: Session, workspace_id: uuid.UUID) -> list[ScoreProfileOut]:
    """The three built-ins, plus the workspace default when it is a custom profile.

    Deliberately not the whole pool yet. The Profiles page draws one "start from"
    button per entry returned here, so listing every custom profile would put
    controls on a page with nowhere to hold them and no way to rename or delete
    them. GET /api/profiles becomes the full pool in phase 7B, where the contract
    and the page that reads it change together.
    """
    pool = _load_pool(session, workspace_id)
    default_id = pool.settings.default_scoring_profile_id
    visible = [
        stored
        for stored in pool.profiles
        if stored.kind is ScoringProfileKind.BUILT_IN or stored.id == default_id
    ]
    return [_stored_output(stored, default_id) for stored in sorted(visible, key=_order_key)]


def _matching_built_in(
    pool: Pool, weights: dict[Category, float], trust_s: float
) -> ScoringProfile | None:
    """The built-in these exact numbers are, if they are still one of them.

    Matched on values rather than on the name the client sent: once a slider has
    moved the profile is no longer that preset, and a built-in row cannot be
    written to anyway.
    """
    for stored in pool.profiles:
        if stored.kind is not ScoringProfileKind.BUILT_IN:
            continue
        if _stored_weights(stored) == weights and stored.trust_slider == trust_s:
            return stored
    return None


def _custom_target(
    session: Session,
    pool: Pool,
    workspace_id: uuid.UUID,
    weights: dict[Category, float],
    trust_s: float,
    actor_user_id: uuid.UUID | None,
) -> ScoringProfile:
    """The custom row `apply` writes these numbers into.

    Transitional, and deliberately re-uses a row instead of adding one: this
    endpoint is the pre-pool "the workspace has a profile and Apply replaces it"
    contract, and creating a row per Apply would march a workspace into the
    five-custom limit through a UI that never offered to name or keep them. The
    Profiles pool UI and its own create/update endpoints arrive in phase 7B.
    """
    if pool.default.kind is ScoringProfileKind.CUSTOM:
        return pool.default
    existing = pool.custom
    if existing:
        return max(existing, key=lambda item: (item.modified_at, item.id))
    created = ScoringProfile(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        kind=ScoringProfileKind.CUSTOM,
        preset_key=None,
        name="Custom",
        created_by_user_id=actor_user_id,
    )
    _write_weights(created, weights, trust_s)
    session.add(created)
    return created


def apply(
    session: Session,
    workspace_id: uuid.UUID,
    weights: dict[str, float],
    s: float,
    actor_user_id: uuid.UUID | None,
    name: str | None = None,
) -> ScoreProfileOut:
    """Clamp these numbers and make them the workspace default (SRS FR-20).

    No analysis, snapshot, finding or queue object is referenced on this write
    path (SRS FR-20/FR-21, SAD section 6.2) — only which profile the workspace
    scores with, and the values of its own custom profile.
    """
    category_weights = {
        Category(key.replace("_", "-")): value for key, value in weights.items()
    }
    clamped_weights, clamped_s = clamp_profile(category_weights, s)
    pool = _load_pool(session, workspace_id)

    target = _matching_built_in(pool, clamped_weights, clamped_s)
    if target is None:
        target = _custom_target(
            session, pool, workspace_id, clamped_weights, clamped_s, actor_user_id
        )
        target.name = name or "Custom"
        _write_weights(target, clamped_weights, clamped_s)
        target.updated_by_user_id = actor_user_id

    pool.settings.default_scoring_profile_id = target.id
    pool.settings.updated_by_user_id = actor_user_id
    session.flush()

    audit.record(
        session,
        event_type="profile_applied",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(target.id),
    )
    return _stored_output(target, target.id)
