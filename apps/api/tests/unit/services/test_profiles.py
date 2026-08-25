import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from codesage_api.scoring.enums import Category
from codesage_api.services.profiles import get_active


def test_get_active_maps_stored_profile_to_scoring_profile() -> None:
    workspace_id = uuid.uuid4()

    stored_profile = SimpleNamespace(
        name="Balanced",
        security_weight=1.2,
        code_design_weight=1.1,
        requirement_weight=0.9,
        documentation_weight=0.8,
        test_weight=1.3,
        trust_slider=0.5,
    )

    query_result = Mock()
    query_result.scalar_one_or_none.return_value = stored_profile

    session = Mock(spec=Session)
    session.execute.return_value = query_result

    profile = get_active(
        session=session,
        workspace_id=workspace_id,
    )

    assert profile.name == "Balanced"
    assert profile.s == pytest.approx(0.5)
    assert profile.weights == {
        Category.SECURITY: 1.2,
        Category.CODE_DESIGN: 1.1,
        Category.REQUIREMENT: 0.9,
        Category.DOCUMENTATION: 0.8,
        Category.TEST: 1.3,
    }

    session.execute.assert_called_once()
    query_result.scalar_one_or_none.assert_called_once_with()


def test_get_active_fails_when_workspace_has_no_active_profile() -> None:
    workspace_id = uuid.uuid4()

    query_result = Mock()
    query_result.scalar_one_or_none.return_value = None

    session = Mock(spec=Session)
    session.execute.return_value = query_result

    with pytest.raises(
        RuntimeError,
        match="Workspace does not have an active scoring profile",
    ):
        get_active(
            session=session,
            workspace_id=workspace_id,
        )