from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.enums import ScoringPresetType, ScoringProfileKind
from codesage_api.db.models import (
    Repository,
    RepositoryProfileAssignment,
    ScoringProfile,
    WorkspaceProfileSettings,
)
from codesage_api.errors import (
    NotFound,
    ProfileBuiltIn,
    ProfileInUse,
    ProfileLimitReached,
    ProfileNameConflict,
)
from codesage_api.schemas import (
    CategoryWeights,
    CategoryWeightsPatch,
    ProjectProfileOut,
    ScoreProfileOut,
)
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


MAX_CUSTOM_PROFILES = 5


@dataclass(frozen=True, slots=True)
class Pool:
    """One workspace's profiles, the pointer in force, and every project override.

    Loaded in one go because almost everything here needs more than one of them:
    a listing needs usage counts, a delete needs to know what still points at the
    row, and resolving a project's effective profile needs both the default and
    the overrides.
    """

    settings: WorkspaceProfileSettings
    profiles: tuple[ScoringProfile, ...]
    assignments: tuple[RepositoryProfileAssignment, ...] = ()

    def find(self, profile_id: uuid.UUID) -> ScoringProfile | None:
        return next((item for item in self.profiles if item.id == profile_id), None)

    def usage_count(self, profile_id: uuid.UUID) -> int:
        return sum(
            1 for item in self.assignments if item.scoring_profile_id == profile_id
        )

    def for_repository(self, repository_id: uuid.UUID) -> ScoringProfile:
        """The profile this project scores with: its override, else the default."""
        assigned = next(
            (item for item in self.assignments if item.repository_id == repository_id),
            None,
        )
        if assigned is not None:
            override = self.find(assigned.scoring_profile_id)
            if override is not None:
                return override
        return self.default

    def override_for(self, repository_id: uuid.UUID) -> ScoringProfile | None:
        assigned = next(
            (item for item in self.assignments if item.repository_id == repository_id),
            None,
        )
        return self.find(assigned.scoring_profile_id) if assigned is not None else None

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
    assignments = session.scalars(
        select(RepositoryProfileAssignment).where(
            RepositoryProfileAssignment.workspace_id == workspace_id
        )
    ).all()
    return Pool(
        settings=settings, profiles=tuple(stored), assignments=tuple(assignments)
    )


def load_pool(session: Session, workspace_id: uuid.UUID) -> Pool:
    """The whole pool, for callers that resolve many projects at once."""
    return _load_pool(session, workspace_id)


def to_scoring_profile(stored: ScoringProfile) -> Profile:
    """The pure scoring input the engine and the cache fingerprint are built from."""
    return Profile(
        weights=_stored_weights(stored), s=stored.trust_slider, name=stored.name
    )


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


def _stored_output(
    stored: ScoringProfile, default_id: uuid.UUID, pool: Pool | None = None
) -> ScoreProfileOut:
    built_in = stored.kind is ScoringProfileKind.BUILT_IN
    return ScoreProfileOut(
        id=str(stored.id),
        name=stored.name,
        weights=_wire_weights(_stored_weights(stored)),
        trust_s=stored.trust_slider,
        is_preset=built_in,
        is_active=stored.id == default_id,
        usage_count=pool.usage_count(stored.id) if pool is not None else 0,
        editable=not built_in,
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
    """The workspace's whole pool: three built-ins first, then its own profiles."""
    pool = _load_pool(session, workspace_id)
    default_id = pool.settings.default_scoring_profile_id
    return [
        _stored_output(stored, default_id, pool)
        for stored in sorted(pool.profiles, key=_order_key)
    ]


def _visible(pool: Pool, profile_id: uuid.UUID) -> ScoringProfile:
    """One profile of this workspace, or the same 404 a nonsense id gets."""
    stored = pool.find(profile_id)
    if stored is None:
        raise NotFound
    return stored


def get(
    session: Session, workspace_id: uuid.UUID, profile_id: uuid.UUID
) -> ScoreProfileOut:
    pool = _load_pool(session, workspace_id)
    return _stored_output(
        _visible(pool, profile_id), pool.settings.default_scoring_profile_id, pool
    )


def _check_name_is_free(
    pool: Pool, name: str, *, excluding: uuid.UUID | None = None
) -> None:
    """Mirror the database's normalized-name rule, so the caller gets a code.

    The unique index is still the enforcement point; this exists only so a clash
    comes back as PROFILE_NAME_CONFLICT instead of an IntegrityError at flush.
    """
    normalized = name.strip().lower()
    for stored in pool.profiles:
        if stored.id != excluding and stored.name.strip().lower() == normalized:
            raise ProfileNameConflict


def create(
    session: Session,
    workspace_id: uuid.UUID,
    name: str,
    weights: dict[str, float],
    trust_s: float,
    actor_user_id: uuid.UUID | None,
) -> ScoreProfileOut:
    """Add one custom profile to the pool. It does not become the default."""
    pool = _load_pool(session, workspace_id)
    if len(pool.custom) >= MAX_CUSTOM_PROFILES:
        raise ProfileLimitReached
    _check_name_is_free(pool, name)

    clamped_weights, clamped_s = clamp_profile(_category_weights(weights), trust_s)
    created = ScoringProfile(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        kind=ScoringProfileKind.CUSTOM,
        preset_key=None,
        name=name.strip(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    _write_weights(created, clamped_weights, clamped_s)
    session.add(created)
    session.flush()

    audit.record(
        session,
        event_type="profile_created",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(created.id),
    )
    return _stored_output(created, pool.settings.default_scoring_profile_id, pool)


def update(
    session: Session,
    workspace_id: uuid.UUID,
    profile_id: uuid.UUID,
    name: str | None,
    weights: CategoryWeightsPatch | None,
    trust_s: float | None,
    actor_user_id: uuid.UUID | None,
) -> ScoreProfileOut:
    """Partially update a custom profile. Omitted fields keep their stored value."""
    pool = _load_pool(session, workspace_id)
    stored = _visible(pool, profile_id)
    if stored.kind is ScoringProfileKind.BUILT_IN:
        raise ProfileBuiltIn

    if name is not None:
        _check_name_is_free(pool, name, excluding=stored.id)

    merged = _stored_weights(stored)
    if weights is not None:
        for field, value in weights.model_dump(exclude_none=True).items():
            merged[Category(field.replace("_", "-"))] = value
    clamped_weights, clamped_s = clamp_profile(
        merged, stored.trust_slider if trust_s is None else trust_s
    )
    if name is not None:
        stored.name = name.strip()
    _write_weights(stored, clamped_weights, clamped_s)
    stored.updated_by_user_id = actor_user_id
    session.flush()

    audit.record(
        session,
        event_type="profile_updated",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(stored.id),
    )
    return _stored_output(stored, pool.settings.default_scoring_profile_id, pool)


def delete(
    session: Session,
    workspace_id: uuid.UUID,
    profile_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
) -> None:
    """Remove an unused custom profile.

    The two foreign keys would refuse an in-use row anyway; checking first is what
    turns that refusal into PROFILE_IN_USE rather than a 500.
    """
    pool = _load_pool(session, workspace_id)
    stored = _visible(pool, profile_id)
    if stored.kind is ScoringProfileKind.BUILT_IN:
        raise ProfileBuiltIn
    if (
        stored.id == pool.settings.default_scoring_profile_id
        or pool.usage_count(stored.id) > 0
    ):
        raise ProfileInUse

    audit.record(
        session,
        event_type="profile_deleted",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(stored.id),
    )
    session.delete(stored)
    session.flush()


def set_default(
    session: Session,
    workspace_id: uuid.UUID,
    profile_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
) -> ScoreProfileOut:
    """Point the workspace at one profile of its own pool. Idempotent."""
    pool = _load_pool(session, workspace_id)
    stored = _visible(pool, profile_id)
    pool.settings.default_scoring_profile_id = stored.id
    pool.settings.updated_by_user_id = actor_user_id
    session.flush()

    audit.record(
        session,
        event_type="profile_default_selected",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="scoring_profile",
        resource_id=str(stored.id),
    )
    return _stored_output(stored, stored.id, pool)


def _project_output(pool: Pool, repository_id: uuid.UUID) -> ProjectProfileOut:
    default_id = pool.settings.default_scoring_profile_id
    override = pool.override_for(repository_id)
    effective = override if override is not None else pool.default
    return ProjectProfileOut(
        repo_id=str(repository_id),
        inherited=override is None,
        effective=_stored_output(effective, default_id, pool),
        workspace_default=_stored_output(pool.default, default_id, pool),
        override=(
            None if override is None else _stored_output(override, default_id, pool)
        ),
    )


def get_project_profile(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID
) -> ProjectProfileOut:
    return _project_output(_load_pool(session, workspace_id), repository_id)


def assign_project(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    profile_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
) -> ProjectProfileOut:
    """Override one project's profile. Idempotent, and never leaves the workspace.

    `_visible` is what keeps a foreign profile out: it is looked up inside this
    workspace's own pool, so another tenant's id is a 404 long before the
    composite foreign key would have refused the write.
    """
    pool = _load_pool(session, workspace_id)
    stored = _visible(pool, profile_id)
    assignment = session.get(RepositoryProfileAssignment, repository_id)
    if assignment is None:
        assignment = RepositoryProfileAssignment(
            repository_id=repository_id,
            workspace_id=workspace_id,
            scoring_profile_id=stored.id,
            updated_by_user_id=actor_user_id,
        )
        session.add(assignment)
        pool = Pool(
            settings=pool.settings,
            profiles=pool.profiles,
            assignments=(*pool.assignments, assignment),
        )
    else:
        assignment.scoring_profile_id = stored.id
        assignment.updated_by_user_id = actor_user_id
    session.flush()

    audit.record(
        session,
        event_type="project_profile_assigned",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="repository",
        resource_id=str(repository_id),
    )
    return _project_output(pool, repository_id)


def clear_project(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
) -> ProjectProfileOut:
    """Drop the override so the project inherits the workspace default again."""
    pool = _load_pool(session, workspace_id)
    assignment = session.get(RepositoryProfileAssignment, repository_id)
    if assignment is not None:
        session.delete(assignment)
        session.flush()
        pool = Pool(
            settings=pool.settings,
            profiles=pool.profiles,
            assignments=tuple(
                item for item in pool.assignments if item.repository_id != repository_id
            ),
        )
        audit.record(
            session,
            event_type="project_profile_cleared",
            outcome="success",
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            resource_type="repository",
            resource_id=str(repository_id),
        )
    return _project_output(pool, repository_id)


def resolve_effective(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID
) -> Profile:
    """THE effective-profile rule: a project's override, else the workspace default.

    Every read path that scores anything goes through this or through the Pool it
    loads, so "which profile is this project scored with" has one answer in the
    codebase rather than one per call site.
    """
    return to_scoring_profile(
        _load_pool(session, workspace_id).for_repository(repository_id)
    )


def repositories_using(
    session: Session, workspace_id: uuid.UUID, profile_id: uuid.UUID
) -> list[uuid.UUID]:
    """Projects whose effective profile is this one: assigned, plus inheriting."""
    pool = _load_pool(session, workspace_id)
    stored = pool.find(profile_id)
    if stored is None:
        return []
    assigned = {
        item.repository_id
        for item in pool.assignments
        if item.scoring_profile_id == profile_id
    }
    if stored.id != pool.settings.default_scoring_profile_id:
        return sorted(assigned)
    overridden = {item.repository_id for item in pool.assignments}
    inheriting = (
        set(
            session.scalars(
                select(Repository.id).where(Repository.workspace_id == workspace_id)
            ).all()
        )
        - overridden
    )
    return sorted(assigned | inheriting)


def _category_weights(weights: dict[str, float]) -> dict[Category, float]:
    return {Category(key.replace("_", "-")): value for key, value in weights.items()}


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
    clamped_weights, clamped_s = clamp_profile(_category_weights(weights), s)
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
