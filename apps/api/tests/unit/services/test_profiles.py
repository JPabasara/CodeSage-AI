from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import ScoringPresetType, ScoringProfileKind
from codesage_api.db.models import ScoringProfile, WorkspaceProfileSettings
from codesage_api.scoring.enums import Category
from codesage_api.services import profiles

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


def _pool(*stored: ScoringProfile, default: ScoringProfile | None = None) -> Mock:
    """A session answering the two reads the profile service makes."""
    chosen = default if default is not None else stored[0]
    settings = WorkspaceProfileSettings(
        workspace_id=WORKSPACE, default_scoring_profile_id=chosen.id
    )
    session = Mock(spec=Session)
    session.get.return_value = settings
    session.scalars.return_value.all.return_value = list(stored)
    session.added = []
    session.add.side_effect = session.added.append
    return session


def _full_pool(default: ScoringProfile | None = None) -> tuple[Mock, list[ScoringProfile]]:
    rows = [_built_in(key) for key in PRESET_VALUES]
    return _pool(*rows, default=default or rows[0]), rows


# ── reads ───────────────────────────────────────────────────────────────────


def test_get_active_returns_the_workspace_default() -> None:
    custom = _custom(security_weight=1.2, code_design_weight=1.1, trust_slider=0.5)
    session, rows = _full_pool()
    session.scalars.return_value.all.return_value = [*rows, custom]
    session.get.return_value.default_scoring_profile_id = custom.id

    profile = profiles.get_active(session, WORKSPACE)

    assert profile.name == "Custom"
    assert profile.s == pytest.approx(0.5)
    assert profile.weights[Category.SECURITY] == pytest.approx(1.2)
    assert profile.weights[Category.CODE_DESIGN] == pytest.approx(1.1)


def test_reads_fail_when_a_workspace_has_no_pool() -> None:
    session = Mock(spec=Session)
    session.get.return_value = None
    with pytest.raises(RuntimeError, match="does not have a scoring profile pool"):
        profiles.get_active(session, WORKSPACE)


def test_reads_fail_when_the_default_is_not_in_the_pool() -> None:
    session, _ = _full_pool()
    session.get.return_value.default_scoring_profile_id = uuid.uuid4()
    with pytest.raises(RuntimeError, match="default scoring profile is missing"):
        profiles.get_active(session, WORKSPACE)


def test_list_available_returns_the_built_ins_in_preset_order() -> None:
    session, rows = _full_pool()
    session.scalars.return_value.all.return_value = [rows[2], rows[0], rows[1]]

    result = profiles.list_available(session, WORKSPACE)

    assert [item.name for item in result] == ["Balanced", "Security-first", "Delivery-speed"]
    assert all(item.is_preset for item in result)
    assert [item.name for item in result if item.is_active] == ["Balanced"]


def test_list_available_hides_custom_profiles_the_page_cannot_manage() -> None:
    """Phase 7B lists the whole pool; the page as it stands draws one button each."""
    session, rows = _full_pool()
    session.scalars.return_value.all.return_value = [*rows, _custom("Left over")]

    result = profiles.list_available(session, WORKSPACE)

    assert [item.name for item in result] == ["Balanced", "Security-first", "Delivery-speed"]


def test_list_available_marks_the_custom_default_active() -> None:
    custom = _custom()
    session, rows = _full_pool()
    session.scalars.return_value.all.return_value = [*rows, custom]
    session.get.return_value.default_scoring_profile_id = custom.id

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
    assert session.get.return_value.default_scoring_profile_id == security_first.id
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
    assert session.get.return_value.default_scoring_profile_id == created.id
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
    session.scalars.return_value.all.return_value = [*rows, custom]
    session.get.return_value.default_scoring_profile_id = custom.id
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
    session.scalars.return_value.all.return_value = [*rows, older, newest]
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
    session.scalars.return_value.all.return_value = [*rows, custom]
    session.get.return_value.default_scoring_profile_id = custom.id
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
