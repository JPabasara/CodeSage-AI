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
    return RuleDefinition(
        rule_id=rule_id,
        category=Category(category_id),
        severity=Severity(severity),
        threshold=threshold,
        message_template=" ".join(message_template.split()),
    )
