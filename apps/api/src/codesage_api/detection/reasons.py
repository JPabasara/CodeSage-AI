from __future__ import annotations


def render_rule_reason(
    template: str,
    *,
    symbol: str,
    file: str,
    value: float,
    threshold: float,
) -> str:
    return template.format(
        symbol=symbol,
        file=file,
        value=f"{value:g}",
        threshold=f"{threshold:g}",
    )


def render_satd_reason(template: str, *, comment_text: str, predicted_category: str) -> str:
    return template.format(
        comment_text=" ".join(comment_text.split()),
        predicted_category=predicted_category,
    )


def render_risk_badge(risk_score: float, indicators: list[str]) -> str:
    suffix = ", ".join(indicators) if indicators else "model indicators"
    return f"High-risk file ({risk_score:.2f}): {suffix}."
