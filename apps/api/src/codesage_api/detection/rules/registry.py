"""Pure detector representation of a database rule definition."""

from __future__ import annotations

from dataclasses import dataclass

from codesage_api.scoring.enums import Category, Severity


@dataclass(frozen=True, slots=True)
class RuleDefinition:
    rule_id: str
    category: Category
    severity: Severity
    message_template: str
    threshold: float


def from_stored(
    *,
    rule_id: str,
    category_id: str,
    severity: str,
    threshold: float,
    message_template: str,
) -> RuleDefinition:
    """Map persistence values at the worker boundary, without coupling the engine to ORM."""
    return RuleDefinition(
        rule_id=rule_id,
        category=Category(category_id),
        severity=Severity(severity),
        threshold=threshold,
        message_template=" ".join(message_template.split()),
    )
