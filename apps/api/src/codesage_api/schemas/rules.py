"""Workspace rule selection wire shapes."""

import uuid
from typing import Literal

from pydantic import Field, field_validator

from codesage_api.schemas.base import ApiModel
from codesage_api.scoring.enums import Category, Severity


class CommentPatternIn(ApiModel):
    match_type: Literal["keyword", "regex"]
    pattern: str = Field(min_length=1, max_length=500)
    case_sensitive: bool = False

    @field_validator("pattern")
    @classmethod
    def nonblank_pattern(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a nonblank pattern.")
        return value


class CommentRule(CommentPatternIn):
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    category: Category
    severity: Severity
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a rule name.")
        return value.strip()


class UpdateCommentRulesIn(ApiModel):
    comment_rules: list[CommentRule] = Field(max_length=50)

    @field_validator("comment_rules")
    @classmethod
    def unique_ids(cls, value: list[CommentRule]) -> list[CommentRule]:
        if len({rule.id for rule in value}) != len(value):
            raise ValueError("Each comment rule needs a unique ID.")
        return value


class CommentPatternTestIn(CommentPatternIn):
    sample_comment: str = Field(max_length=20000)


class CommentPatternTestOut(ApiModel):
    matched: bool


class RuleOptionOut(ApiModel):
    rule_id: str
    category: Category
    description: str


class WorkspaceRulesOut(ApiModel):
    rules: list[RuleOptionOut]
    disabled_rule_ids: list[str]
    comment_rules: list[CommentRule] = Field(default_factory=list)


class UpdateWorkspaceRulesIn(ApiModel):
    disabled_rule_ids: list[str]
