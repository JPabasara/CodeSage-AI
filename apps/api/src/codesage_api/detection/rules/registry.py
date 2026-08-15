"""Loads the rule register from `register.yaml` (SRS Appendix C.1)."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from codesage_api.scoring.enums import Category, Severity

_REGISTER = Path(__file__).parent / "register.yaml"


@dataclass(frozen=True, slots=True)
class RuleDefinition:
    rule_id: str
    category: Category
    severity: Severity
    base_points: int
    mechanism: str  # metric | pattern
    message_template: str
    metric_name: str | None = None
    threshold: float | None = None
    scope: str = "symbol"  # symbol | file


@lru_cache
def get_rules() -> tuple[RuleDefinition, ...]:
    raw = yaml.safe_load(_REGISTER.read_text(encoding="utf-8"))
    return tuple(
        RuleDefinition(
            rule_id=r["rule_id"],
            category=Category(r["category"]),
            severity=Severity(r["severity"]),
            base_points=int(r["base_points"]),
            mechanism=r["mechanism"],
            message_template=" ".join(r["message_template"].split()),
            metric_name=r.get("metric_name"),
            threshold=float(r["threshold"]) if r.get("threshold") is not None else None,
            scope=r.get("scope", "symbol"),
        )
        for r in raw["rules"]
    )


@lru_cache
def get_rule(rule_id: str) -> RuleDefinition:
    for rule in get_rules():
        if rule.rule_id == rule_id:
            return rule
    raise KeyError(f"unknown rule_id: {rule_id}")
