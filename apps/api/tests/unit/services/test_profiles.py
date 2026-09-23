from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import ScoringPresetType, ScoringProfileKind
from codesage_api.db.models import (
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
from codesage_api.schemas import CategoryWeightsPatch
from codesage_api.scoring.enums import Category
from codesage_api.services import profiles

REPOSITORY = uuid.uuid4()
OTHER_REPOSITORY = uuid.uuid4()

WORKSPACE = uuid.uuid4()
NOW = datetime(2026, 9, 23, tzinfo=UTC)

PRESET_VALUES = {
    ScoringPresetType.BALANCED: ("Balanced", 1.0, 1.0, 1.0, 1.0, 1.0, 0.5),
    ScoringPresetType.SECURITY_FIRST: ("Security-first", 3.0, 1.0, 0.8, 0.5, 1.0, 0.5),
    ScoringPresetType.DELIVERY_SPEED: ("Delivery-speed", 1.5, 1.2, 0.8, 0.5, 0.5, 0.7),
}


def _built_in(preset_key: ScoringPresetType) -> ScoringProfile:
    name, security, code_design, requirement, documentation, test, trust = PRESET_VALUES[
        preset_key
    ]
    return ScoringProfile(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        kind=ScoringProfileKind.BUILT_IN,
        preset_key=preset_key,
        name=name,
        security_weight=security,
        code_design_weight=code_design,
        requirement_weight=requirement,
        documentation_weight=documentation,
        test_weight=test,
        trust_slider=trust,
        modified_at=NOW,
    )


def _custom(name: str = "Custom", *, age: int = 0, **overrides: float) -> ScoringProfile:
    values: dict[str, float] = {
        "security_weight": 2.25,
        "code_design_weight": 1.0,
        "requirement_weight": 1.0,
        "documentation_weight": 1.0,
        "test_weight": 1.0,
        "trust_slider": 0.25,
    }
    values.update(overrides)
    return ScoringProfile(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        kind=ScoringProfileKind.CUSTOM,
        preset_key=None,
        name=name,
        modified_at=NOW - timedelta(days=age),
        **values,
    )


def _assignment(repository_id: uuid.UUID, profile: ScoringProfile) -> RepositoryProfileAssignment:
    return RepositoryProfileAssignment(
        repository_id=repository_id,
        workspace_id=WORKSPACE,
        scoring_profile_id=profile.id,
    )


def _pool(
    *stored: ScoringProfile,
    default: ScoringProfile | None = None,
    assignments: list[RepositoryProfileAssignment] | None = None,
) -> Mock:
    """A session answering the reads the profile service makes.

    `scalars` is keyed off the entity being selected rather than call order, so a
    service function is free to load the pool more than once without the stub
    silently handing back the wrong rows.
    """
    chosen = default if default is not None else stored[0]
    settings = WorkspaceProfileSettings(
        workspace_id=WORKSPACE, default_scoring_profile_id=chosen.id
    )
    session = Mock(spec=Session)
    session.rows = list(stored)
    session.assignments = list(assignments or [])

    def scalars(statement: object) -> Mock:
        entity = statement.column_descriptions[0]["entity"]  # type: ignore[attr-defined]
        if entity is RepositoryProfileAssignment:
            rows: list[object] = session.assignments
        else:
            rows = session.rows
        return Mock(all=Mock(return_value=list(rows)))

    def get(model: type, key: object) -> object | None:
        if model is WorkspaceProfileSettings:
            return settings
        return next(
            (item for item in session.assignments if item.repository_id == key), None
        )

    session.scalars.side_effect = scalars
    session.get.side_effect = get
    session.settings = settings
    session.added = []
    session.add.side_effect = session.added.append
    session.deleted = []
    session.delete.side_effect = session.deleted.append
    return session


def _full_pool(
    default: ScoringProfile | None = None,
    *,
    custom: list[ScoringProfile] | None = None,
    assignments: list[RepositoryProfileAssignment] | None = None,
) -> tuple[Mock, list[ScoringProfile]]:
    rows = [_built_in(key) for key in PRESET_VALUES]
    session = _pool(
        *rows,
        *(custom or []),
        default=default or rows[0],
        assignments=assignments,
    )
    return session, rows


# ── reads ───────────────────────────────────────────────────────────────────


def test_get_active_returns_the_workspace_default() -> None:
    custom = _custom(security_weight=1.2, code_design_weight=1.1, trust_slider=0.5)
    session, rows = _full_pool()
    session.rows = [*rows, custom]
    session.settings.default_scoring_profile_id = custom.id

    profile = profiles.get_active(session, WORKSPACE)

    assert profile.name == "Custom"
    assert profile.s == pytest.approx(0.5)
    assert profile.weights[Category.SECURITY] == pytest.approx(1.2)
    assert profile.weights[Category.CODE_DESIGN] == pytest.approx(1.1)


def test_reads_fail_when_a_workspace_has_no_pool() -> None:
    session = Mock(spec=Session)
    session.get.return_value = None
    session.scalars.return_value.all.return_value = []
    with pytest.raises(RuntimeError, match="does not have a scoring profile pool"):
        profiles.get_active(session, WORKSPACE)


def test_reads_fail_when_the_default_is_not_in_the_pool() -> None:
    session, _ = _full_pool()
    session.settings.default_scoring_profile_id = uuid.uuid4()
    with pytest.raises(RuntimeError, match="default scoring profile is missing"):
        profiles.get_active(session, WORKSPACE)


def test_list_available_returns_the_built_ins_in_preset_order() -> None:
    session, rows = _full_pool()
    session.rows = [rows[2], rows[0], rows[1]]

    result = profiles.list_available(session, WORKSPACE)

    assert [item.name for item in result] == ["Balanced", "Security-first", "Delivery-speed"]
    assert all(item.is_preset for item in result)
    assert [item.name for item in result if item.is_active] == ["Balanced"]


def test_list_available_returns_the_whole_pool_with_usage_and_mutability() -> None:
    chosen = _custom("Release gate")
    session, _rows = _full_pool(custom=[chosen, _custom("Unused")])
    session.assignments = [_assignment(REPOSITORY, chosen), _assignment(OTHER_REPOSITORY, chosen)]

    result = profiles.list_available(session, WORKSPACE)

    assert [item.name for item in result] == [
        "Balanced",
        "Security-first",
        "Delivery-speed",
        "Release gate",
        "Unused",
    ]
    assert [item.is_preset for item in result] == [True, True, True, False, False]
    assert [item.editable for item in result] == [False, False, False, True, True]
    # The default is in force for every project without an override, which
    # is_active already says, so it is not double-counted as usage.
    assert [item.usage_count for item in result] == [0, 0, 0, 2, 0]
    assert [item.name for item in result if item.is_active] == ["Balanced"]


def test_list_available_marks_the_custom_default_active() -> None:
    custom = _custom()
    session, rows = _full_pool()
    session.rows = [*rows, custom]
    session.settings.default_scoring_profile_id = custom.id

    result = profiles.list_available(session, WORKSPACE)

    assert len(result) == 4
    assert [item.name for item in result if item.is_active] == ["Custom"]
    assert result[-1].id == str(custom.id)


# ── seeding ─────────────────────────────────────────────────────────────────


def test_every_configured_preset_has_a_stored_preset_key() -> None:
    """A preset the map does not know would fail at first sign-in, not at import."""
    from codesage_api.scoring.config_loader import get_presets

    assert set(get_presets()) == set(profiles.PRESET_KEYS)
    assert set(profiles.PRESET_KEYS.values()) == set(ScoringPresetType)


def test_seeding_creates_three_built_ins_and_a_balanced_default() -> None:
    session = Mock(spec=Session)
    added: list[object] = []
    session.add.side_effect = added.append

    profiles.seed_workspace_profiles(session, WORKSPACE, actor_user_id=None)

    seeded = [item for item in added if isinstance(item, ScoringProfile)]
    settings = next(item for item in added if isinstance(item, WorkspaceProfileSettings))
    assert [item.name for item in seeded] == ["Balanced", "Security-first", "Delivery-speed"]
    assert all(item.kind is ScoringProfileKind.BUILT_IN for item in seeded)
    assert {item.preset_key for item in seeded} == set(ScoringPresetType)
    balanced = next(item for item in seeded if item.preset_key is ScoringPresetType.BALANCED)
    assert settings.default_scoring_profile_id == balanced.id
    assert balanced.security_weight == pytest.approx(1.0)
    assert balanced.trust_slider == pytest.approx(0.5)


# ── apply ───────────────────────────────────────────────────────────────────


def test_apply_selects_a_built_in_instead_of_writing_to_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sliders set back to a preset's numbers select that row; nothing is edited."""
    session, rows = _full_pool()
    security_first = rows[1]
    monkeypatch.setattr(profiles.audit, "record", Mock())

    result = profiles.apply(
        session,
        WORKSPACE,
        {
            "security": 3.0,
            "code_design": 1.0,
            "requirement": 0.8,
            "documentation": 0.5,
            "test": 1.0,
        },
        0.5,
        uuid.uuid4(),
        "Security-first",
    )

    assert result.id == str(security_first.id)
    assert result.is_preset is True
    assert result.is_active is True
    assert session.settings.default_scoring_profile_id == security_first.id
    assert session.added == []
    assert security_first.updated_by_user_id is None


def test_apply_clamps_and_creates_one_custom_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor = uuid.uuid4()
    session, _ = _full_pool()
    record = Mock()
    monkeypatch.setattr(profiles.audit, "record", record)

    result = profiles.apply(
        session,
        WORKSPACE,
        {
            "security": 9.0,
            "code_design": -2.0,
            "requirement": 0.8,
            "documentation": 0.5,
            "test": 1.0,
        },
        5.0,
        actor,
    )

    created = session.added[0]
    assert isinstance(created, ScoringProfile)
    assert created.kind is ScoringProfileKind.CUSTOM
    assert created.preset_key is None
    assert created.name == "Custom"
    assert created.created_by_user_id == actor
    assert created.security_weight == pytest.approx(3.0)
    assert created.code_design_weight == pytest.approx(0.1)
    assert created.trust_slider == pytest.approx(1.0)
    assert result.weights.security == pytest.approx(3.0)
    assert result.weights.code_design == pytest.approx(0.1)
    assert result.trust_s == pytest.approx(1.0)
    assert result.is_preset is False
    assert session.settings.default_scoring_profile_id == created.id
    session.flush.assert_called_once_with()
    record.assert_called_once_with(
        session,
        event_type="profile_applied",
        outcome="success",
        workspace_id=WORKSPACE,
        actor_user_id=actor,
        resource_type="scoring_profile",
        resource_id=str(created.id),
    )


def test_apply_rewrites_the_custom_default_in_place(monkeypatch: pytest.MonkeyPatch) -> None:
    custom = _custom()
    session, rows = _full_pool()
    session.rows = [*rows, custom]
    session.settings.default_scoring_profile_id = custom.id
    monkeypatch.setattr(profiles.audit, "record", Mock())

    result = profiles.apply(
        session,
        WORKSPACE,
        {
            "security": 1.5,
            "code_design": 1.2,
            "requirement": 0.8,
            "documentation": 0.5,
            "test": 0.5,
        },
        0.6,
        uuid.uuid4(),
        "Renamed",
    )

    assert session.added == []
    assert result.id == str(custom.id)
    assert custom.name == "Renamed"
    assert custom.security_weight == pytest.approx(1.5)


def test_apply_reuses_the_newest_custom_row_rather_than_adding_a_sixth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A preset/custom/preset/custom loop must not march into the five limit."""
    newest = _custom("Newest", age=0)
    older = _custom("Older", age=3)
    session, rows = _full_pool()
    session.rows = [*rows, older, newest]
    monkeypatch.setattr(profiles.audit, "record", Mock())

    result = profiles.apply(
        session,
        WORKSPACE,
        {
            "security": 2.0,
            "code_design": 1.0,
            "requirement": 1.0,
            "documentation": 1.0,
            "test": 1.0,
        },
        0.4,
        uuid.uuid4(),
    )

    assert session.added == []
    assert result.id == str(newest.id)
    assert older.security_weight == pytest.approx(2.25)


def test_apply_is_idempotent_for_the_complete_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    custom = _custom()
    session, rows = _full_pool()
    session.rows = [*rows, custom]
    session.settings.default_scoring_profile_id = custom.id
    monkeypatch.setattr(profiles.audit, "record", Mock())
    body = {
        "security": 1.5,
        "code_design": 1.2,
        "requirement": 0.8,
        "documentation": 0.5,
        "test": 0.5,
    }

    first = profiles.apply(session, WORKSPACE, body, 0.7, uuid.uuid4(), "Delivery-speed")
    second = profiles.apply(session, WORKSPACE, body, 0.7, uuid.uuid4(), "Delivery-speed")

    assert first == second
    assert first.id == str(rows[2].id)
    assert first.is_preset is True
    assert session.added == []


# ── pool CRUD ───────────────────────────────────────────────────────────────


def _weights(security: float = 1.0) -> dict[str, float]:
    return {
        "security": security,
        "code_design": 1.0,
        "requirement": 1.0,
        "documentation": 1.0,
        "test": 1.0,
    }


def test_create_clamps_and_adds_a_custom_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = uuid.uuid4()
    session, _ = _full_pool()
    record = Mock()
    monkeypatch.setattr(profiles.audit, "record", record)

    result = profiles.create(session, WORKSPACE, "  Release gate  ", _weights(9.0), 5.0, actor)

    created = session.added[0]
    assert created.kind is ScoringProfileKind.CUSTOM
    assert created.preset_key is None
    assert created.name == "Release gate"
    assert created.created_by_user_id == actor
    assert created.security_weight == pytest.approx(3.0)
    assert created.trust_slider == pytest.approx(1.0)
    # Creating does not change what the workspace scores with.
    assert session.settings.default_scoring_profile_id != created.id
    assert result.is_active is False
    assert result.editable is True
    assert record.call_args.kwargs["event_type"] == "profile_created"


def test_create_refuses_the_sixth_custom_profile() -> None:
    session, _ = _full_pool(custom=[_custom(f"Custom {index}") for index in range(5)])

    with pytest.raises(ProfileLimitReached):
        profiles.create(session, WORKSPACE, "One too many", _weights(), 0.5, None)

    assert session.added == []


def test_create_refuses_a_name_another_profile_already_uses() -> None:
    session, _ = _full_pool()

    with pytest.raises(ProfileNameConflict):
        profiles.create(session, WORKSPACE, "  balanced ", _weights(), 0.5, None)

    assert session.added == []


def test_update_merges_only_the_fields_that_were_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = _custom("Ours", security_weight=2.0, code_design_weight=1.4, trust_slider=0.3)
    session, _ = _full_pool(custom=[target])
    monkeypatch.setattr(profiles.audit, "record", Mock())

    result = profiles.update(
        session,
        WORKSPACE,
        target.id,
        "Renamed",
        CategoryWeightsPatch(security=9.0),
        None,
        uuid.uuid4(),
    )

    assert target.name == "Renamed"
    assert target.security_weight == pytest.approx(3.0)  # clamped
    assert target.code_design_weight == pytest.approx(1.4)  # untouched
    assert target.trust_slider == pytest.approx(0.3)  # untouched
    assert result.name == "Renamed"


def test_update_with_an_empty_body_changes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    target = _custom("Ours", security_weight=2.0)
    session, _ = _full_pool(custom=[target])
    monkeypatch.setattr(profiles.audit, "record", Mock())

    profiles.update(session, WORKSPACE, target.id, None, None, None, None)

    assert target.name == "Ours"
    assert target.security_weight == pytest.approx(2.0)


def test_update_and_delete_refuse_built_ins() -> None:
    session, rows = _full_pool()

    with pytest.raises(ProfileBuiltIn):
        profiles.update(session, WORKSPACE, rows[1].id, "Renamed", None, None, None)
    with pytest.raises(ProfileBuiltIn):
        profiles.delete(session, WORKSPACE, rows[1].id, None)

    assert rows[1].name == "Security-first"
    assert session.deleted == []


def test_update_refuses_a_name_another_profile_holds_but_allows_its_own() -> None:
    target = _custom("Ours")
    session, _ = _full_pool(custom=[target, _custom("Theirs")])

    with pytest.raises(ProfileNameConflict):
        profiles.update(session, WORKSPACE, target.id, "theirs", None, None, None)

    # Re-sending its own name is not a clash with itself.
    profiles.update(session, WORKSPACE, target.id, "Ours", None, None, None)
    assert target.name == "Ours"


def test_delete_refuses_the_default_and_any_assigned_profile() -> None:
    chosen = _custom("Chosen")
    assigned = _custom("Assigned")
    session, _ = _full_pool(
        default=None,
        custom=[chosen, assigned],
        assignments=[_assignment(REPOSITORY, assigned)],
    )
    session.settings.default_scoring_profile_id = chosen.id

    with pytest.raises(ProfileInUse):
        profiles.delete(session, WORKSPACE, chosen.id, None)
    with pytest.raises(ProfileInUse):
        profiles.delete(session, WORKSPACE, assigned.id, None)

    assert session.deleted == []


def test_delete_removes_an_unused_custom_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    unused = _custom("Unused")
    session, _ = _full_pool(custom=[unused])
    monkeypatch.setattr(profiles.audit, "record", Mock())

    profiles.delete(session, WORKSPACE, unused.id, None)

    assert session.deleted == [unused]


def test_another_workspaces_profile_is_indistinguishable_from_a_missing_one() -> None:
    session, _ = _full_pool()
    foreign = uuid.uuid4()

    for call in (
        lambda: profiles.get(session, WORKSPACE, foreign),
        lambda: profiles.update(session, WORKSPACE, foreign, "x", None, None, None),
        lambda: profiles.delete(session, WORKSPACE, foreign, None),
        lambda: profiles.set_default(session, WORKSPACE, foreign, None),
        lambda: profiles.assign_project(session, WORKSPACE, REPOSITORY, foreign, None),
    ):
        with pytest.raises(NotFound):
            call()


# ── the workspace default ───────────────────────────────────────────────────


def test_set_default_selects_any_pool_member_and_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session, rows = _full_pool()
    monkeypatch.setattr(profiles.audit, "record", Mock())

    first = profiles.set_default(session, WORKSPACE, rows[2].id, uuid.uuid4())
    second = profiles.set_default(session, WORKSPACE, rows[2].id, uuid.uuid4())

    assert first.id == second.id == str(rows[2].id)
    assert first.is_active is True
    assert session.settings.default_scoring_profile_id == rows[2].id
    assert session.added == []
    assert session.deleted == []


# ── project overrides ───────────────────────────────────────────────────────


def test_a_project_with_no_override_inherits_the_workspace_default() -> None:
    session, rows = _full_pool()

    result = profiles.get_project_profile(session, WORKSPACE, REPOSITORY)

    assert result.inherited is True
    assert result.override is None
    assert result.effective.id == str(rows[0].id)
    assert result.workspace_default.id == str(rows[0].id)


def test_assigning_an_override_replaces_rather_than_adds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session, rows = _full_pool()
    monkeypatch.setattr(profiles.audit, "record", Mock())

    first = profiles.assign_project(session, WORKSPACE, REPOSITORY, rows[1].id, None)
    assert first.inherited is False
    assert first.override is not None
    assert first.effective.id == str(rows[1].id)
    assert len(session.added) == 1

    session.assignments = [item for item in session.added]
    second = profiles.assign_project(session, WORKSPACE, REPOSITORY, rows[2].id, None)

    assert second.effective.id == str(rows[2].id)
    assert len(session.added) == 1, "a second choice must not add a second override"


def test_clearing_an_override_restores_inheritance(monkeypatch: pytest.MonkeyPatch) -> None:
    session, rows = _full_pool()
    assignment = _assignment(REPOSITORY, rows[1])
    session.assignments = [assignment]
    monkeypatch.setattr(profiles.audit, "record", Mock())

    result = profiles.clear_project(session, WORKSPACE, REPOSITORY, None)

    assert session.deleted == [assignment]
    assert result.inherited is True
    assert result.override is None
    assert result.effective.id == str(rows[0].id)


def test_clearing_a_project_that_never_had_an_override_is_a_no_op() -> None:
    session, rows = _full_pool()

    result = profiles.clear_project(session, WORKSPACE, REPOSITORY, None)

    assert session.deleted == []
    assert result.inherited is True
    assert result.effective.id == str(rows[0].id)


def test_resolve_effective_prefers_the_override_over_the_default() -> None:
    session, rows = _full_pool()
    session.assignments = [_assignment(REPOSITORY, rows[1])]

    overridden = profiles.resolve_effective(session, WORKSPACE, REPOSITORY)
    inheriting = profiles.resolve_effective(session, WORKSPACE, OTHER_REPOSITORY)

    assert overridden.name == "Security-first"
    assert overridden.weights[Category.SECURITY] == pytest.approx(3.0)
    assert inheriting.name == "Balanced"
    assert inheriting.weights[Category.SECURITY] == pytest.approx(1.0)


def test_two_projects_in_one_workspace_can_resolve_to_different_profiles() -> None:
    """The reason the dashboard and the project cards resolve per project."""
    session, rows = _full_pool()
    session.assignments = [
        _assignment(REPOSITORY, rows[1]),
        _assignment(OTHER_REPOSITORY, rows[2]),
    ]

    first = profiles.resolve_effective(session, WORKSPACE, REPOSITORY)
    second = profiles.resolve_effective(session, WORKSPACE, OTHER_REPOSITORY)

    assert first.name != second.name
    assert first.s != second.s
