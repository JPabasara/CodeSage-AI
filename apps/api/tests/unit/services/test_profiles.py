import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from codesage_api.scoring.enums import Category
from codesage_api.services import profiles


def _stored(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "name": "Balanced",
        "security_weight": 1.0,
        "code_design_weight": 1.0,
        "requirement_weight": 1.0,
        "documentation_weight": 1.0,
        "test_weight": 1.0,
        "trust_slider": 0.5,
        "is_active": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _session_with(stored: SimpleNamespace | None) -> Mock:
    session = Mock(spec=Session)
    session.scalar.return_value = stored
    return session


def test_get_active_maps_stored_profile_to_scoring_profile() -> None:
    session = _session_with(
        _stored(
            security_weight=1.2,
            code_design_weight=1.1,
            requirement_weight=0.9,
            documentation_weight=0.8,
            test_weight=1.3,
        )
    )

    profile = profiles.get_active(session, uuid.uuid4())

    assert profile.name == "Balanced"
    assert profile.s == pytest.approx(0.5)
    assert profile.weights == {
        Category.SECURITY: 1.2,
        Category.CODE_DESIGN: 1.1,
        Category.REQUIREMENT: 0.9,
        Category.DOCUMENTATION: 0.8,
        Category.TEST: 1.3,
    }


def test_get_active_fails_when_workspace_has_no_active_profile() -> None:
    with pytest.raises(
        RuntimeError,
        match="Workspace does not have an active scoring profile",
    ):
        profiles.get_active(_session_with(None), uuid.uuid4())


def test_list_available_returns_presets_and_active_custom_profile() -> None:
    custom = _stored(name="Custom", security_weight=2.25, trust_slider=0.25)

    result = profiles.list_available(_session_with(custom), uuid.uuid4())

    assert [item.name for item in result] == [
        "Balanced",
        "Security-first",
        "Delivery-speed",
        "Custom",
    ]
    assert all(item.is_preset for item in result[:3])
    assert result[-1].id == str(custom.id)
    assert result[-1].is_preset is False
    assert result[-1].is_active is True


def test_list_available_marks_matching_preset_active_without_duplicate() -> None:
    result = profiles.list_available(_session_with(_stored()), uuid.uuid4())

    assert len(result) == 3
    assert [item.name for item in result if item.is_active] == ["Balanced"]


def test_apply_clamps_and_updates_same_row_without_creating_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    stored = _stored()
    session = _session_with(stored)
    record = Mock()
    monkeypatch.setattr(profiles.audit, "record", record)

    result = profiles.apply(
        session,
        workspace_id,
        {
            "security": 9.0,
            "code_design": -2.0,
            "requirement": 0.8,
            "documentation": 0.5,
            "test": 1.0,
        },
        5.0,
        actor_id,
        "Security-first",
    )

    assert stored.id == uuid.UUID(result.id)
    assert stored.security_weight == pytest.approx(3.0)
    assert stored.code_design_weight == pytest.approx(0.1)
    assert stored.trust_slider == pytest.approx(1.0)
    assert result.weights.security == pytest.approx(3.0)
    assert result.weights.code_design == pytest.approx(0.1)
    assert result.trust_s == pytest.approx(1.0)
    assert result.is_preset is False
    session.add.assert_not_called()
    session.flush.assert_called_once_with()
    record.assert_called_once_with(
        session,
        event_type="profile_applied",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_id,
        resource_type="scoring_profile",
        resource_id=str(stored.id),
    )


def test_apply_is_idempotent_for_the_complete_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored = _stored()
    session = _session_with(stored)
    monkeypatch.setattr(profiles.audit, "record", Mock())
    body = {
        "security": 1.5,
        "code_design": 1.2,
        "requirement": 0.8,
        "documentation": 0.5,
        "test": 0.5,
    }

    first = profiles.apply(session, uuid.uuid4(), body, 0.7, uuid.uuid4(), "Delivery-speed")
    second = profiles.apply(session, uuid.uuid4(), body, 0.7, uuid.uuid4(), "Delivery-speed")

    assert first == second
    assert first.id == str(stored.id)
    assert first.is_preset is True
