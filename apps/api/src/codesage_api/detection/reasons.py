from __future__ import annotations


def render_rule_reason(template: str, *, symbol: str, file: str, value: float, threshold: float) -> str:
    raise NotImplementedError


def render_satd_reason(template: str, *, comment_text: str, predicted_category: str) -> str:

    raise NotImplementedError


def render_risk_badge(risk_score: float, indicators: list[str]) -> str:
    raise NotImplementedError
