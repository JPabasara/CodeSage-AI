"""Workspace-wide deterministic rule selection; scans freeze their own copy."""

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.db.models import Workspace
from codesage_api.db.repositories import rules
from codesage_api.detection.comment_rules import compile_pattern
from codesage_api.detection.pmd.mapping import enabled_rules
from codesage_api.errors import NotFound, ValidationFailed
from codesage_api.schemas.rules import CommentRule, RuleOptionOut, WorkspaceRulesOut

# The metric and source-pattern rules implemented by the core detector.
CORE_RULE_IDS = frozenset(
    {
        "large-file",
        "complex-function",
        "long-method",
        "deep-nesting",
        "hardcoded-secret",
        "sql-concat",
    }
)


def catalog(session: Session) -> list[RuleOptionOut]:
    pmd_directory = Path(__file__).parents[1] / "detection" / "pmd" / "rulesets"
    supported = CORE_RULE_IDS | {f"pmd:{name}" for name in enabled_rules(pmd_directory)}
    return [
        RuleOptionOut(
            rule_id=rule.rule_id,
            category=rule.category_id,
            description=rule.message_template,
        )
        for rule in rules.list_definitions(session)
        if rule.rule_id in supported
    ]


def disabled_rules(session: Session, workspace_id: uuid.UUID) -> list[str]:
    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound
    return sorted(set(workspace.disabled_rule_ids or []))


def get(session: Session, workspace_id: uuid.UUID) -> WorkspaceRulesOut:
    return WorkspaceRulesOut(
        rules=catalog(session),
        disabled_rule_ids=disabled_rules(session, workspace_id),
        comment_rules=comment_rules(session, workspace_id),
    )


def update(session: Session, workspace_id: uuid.UUID, disabled: list[str]) -> WorkspaceRulesOut:
    available = catalog(session)
    unknown = set(disabled) - {rule.rule_id for rule in available}
    if unknown:
        raise ValidationFailed("Unknown rule IDs: " + ", ".join(sorted(unknown)))
    workspace = session.scalar(
        select(Workspace).where(Workspace.id == workspace_id).with_for_update()
    )
    if workspace is None:
        raise NotFound
    normalized = sorted(set(disabled))
    workspace.disabled_rule_ids = normalized
    comments = getattr(workspace, "comment_rules", None) or []
    session.commit()
    return WorkspaceRulesOut(rules=available, disabled_rule_ids=normalized, comment_rules=comments)


def comment_rules(session: Session, workspace_id: uuid.UUID) -> list[dict]:
    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound
    return list(getattr(workspace, "comment_rules", None) or [])


def update_comments(
    session: Session, workspace_id: uuid.UUID, comments: list[CommentRule]
) -> WorkspaceRulesOut:
    for rule in comments:
        compile_pattern(rule)
    workspace = session.scalar(
        select(Workspace).where(Workspace.id == workspace_id).with_for_update()
    )
    if workspace is None:
        raise NotFound
    normalized = [rule.model_dump(mode="json") for rule in comments]
    workspace.comment_rules = normalized
    result = WorkspaceRulesOut(
        rules=catalog(session),
        disabled_rule_ids=workspace.disabled_rule_ids or [],
        comment_rules=normalized,
    )
    session.commit()
    return result
