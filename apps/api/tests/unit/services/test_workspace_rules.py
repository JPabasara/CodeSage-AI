from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from codesage_api.db.models import Workspace
from codesage_api.errors import NotFound, ValidationFailed
from codesage_api.services import workspace_rules


def definition(rule_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        rule_id=rule_id, category_id="code-design", message_template="Example rule"
    )


@pytest.fixture
def session(monkeypatch):
    session = Mock()
    session.get.return_value = SimpleNamespace(disabled_rule_ids=[])
    session.scalar.return_value = session.get.return_value
    monkeypatch.setattr(
        workspace_rules.rules,
        "list_definitions",
        lambda _: [
            definition("large-file"),
            definition("pmd:EmptyCatchBlock"),
            definition("obsolete-rule"),
        ],
    )
    return session


def test_all_supported_rules_are_enabled_initially(session):
    workspace_id = uuid.uuid4()
    result = workspace_rules.get(session, workspace_id)
    assert {rule.rule_id for rule in result.rules} == {"large-file", "pmd:EmptyCatchBlock"}
    assert result.disabled_rule_ids == []
    session.get.assert_called_with(Workspace, workspace_id)


def test_saves_normalized_workspace_selection_and_can_restore_all(session):
    result = workspace_rules.update(session, uuid.uuid4(), ["large-file", "large-file"])
    assert result.disabled_rule_ids == ["large-file"]
    assert session.scalar.return_value.disabled_rule_ids == ["large-file"]
    session.commit.assert_called_once()
    assert workspace_rules.update(session, uuid.uuid4(), []).disabled_rule_ids == []


def test_unknown_rules_are_rejected_without_mutation(session):
    with pytest.raises(ValidationFailed):
        workspace_rules.update(session, uuid.uuid4(), ["unknown"])
    session.scalar.assert_not_called()
    session.commit.assert_not_called()


def test_missing_workspace_is_not_found(session):
    session.get.return_value = None
    with pytest.raises(NotFound):
        workspace_rules.get(session, uuid.uuid4())


def test_comment_rule_writes_preserve_detector_selections_and_reject_invalid_regex(session):
    from codesage_api.schemas.rules import CommentRule
    session.scalar.return_value.disabled_rule_ids = ["large-file"]
    rule = CommentRule(id=uuid.uuid4(), name="Security markers", match_type="keyword", pattern="SECURITY-TODO", category="security", severity="high")
    result = workspace_rules.update_comments(session, uuid.uuid4(), [rule])
    assert result.disabled_rule_ids == ["large-file"]
    assert result.comment_rules == [rule]
    assert session.scalar.return_value.comment_rules == [rule.model_dump(mode="json")]
    result = workspace_rules.update(session, uuid.uuid4(), [])
    assert result.comment_rules == [rule]
    session.reset_mock()
    rule.match_type = "regex"
    rule.pattern = "["
    with pytest.raises(ValidationFailed):
        workspace_rules.update_comments(session, uuid.uuid4(), [rule])
    session.commit.assert_not_called()
