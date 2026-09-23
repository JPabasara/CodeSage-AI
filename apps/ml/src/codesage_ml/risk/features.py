"""Canonical ML-2 feature contract.

This module defines the raw feature names and ordering expected by the
bug-proneness model.

Each observation represents one Java class:

    class-specific CK metrics
        +
    process metrics for the containing source file

Training and inference must use this same contract so that feature ordering
cannot silently diverge.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Class-level CK product metrics
# ---------------------------------------------------------------------------

PRODUCT_FEATURES: tuple[str, ...] = (
    "wmc",
    "cbo",
    "dit",
    "lcom",
    "rfc",
    "noc",
    "numberOfLinesOfCode",
    "numberOfMethods",
)


# ---------------------------------------------------------------------------
# File-level process metrics
# ---------------------------------------------------------------------------

PROCESS_FEATURES: tuple[str, ...] = (
    "numberOfVersionsUntil",
    "numberOfAuthorsUntil",
    "linesAddedUntil",
    "maxLinesAddedUntil",
    "avgLinesAddedUntil",
    "linesRemovedUntil",
    "maxLinesRemovedUntil",
    "avgLinesRemovedUntil",
    "codeChurnUntil",
    "maxCodeChurnUntil",
    "avgCodeChurnUntil",
    "ageWithRespectTo",
    "weightedAgeWithRespectTo",
)


# ---------------------------------------------------------------------------
# Complete model input contract
# ---------------------------------------------------------------------------

FEATURE_ORDER: tuple[str, ...] = (
    PRODUCT_FEATURES + PROCESS_FEATURES
)


def build_vector(
    metrics: dict[str, float],
) -> list[float]:
    """
    Assemble one class observation in canonical training order.

    The API supplies an explicit value for every feature, including zeroes for
    unavailable history. Reject contract drift instead of silently changing the
    observation seen by the model.
    """
    expected = set(FEATURE_ORDER)
    actual = set(metrics)
    missing = expected - actual
    unexpected = actual - expected

    if missing:
        raise ValueError(f"Missing ML-2 features: {sorted(missing)}")
    if unexpected:
        raise ValueError(f"Unexpected ML-2 features: {sorted(unexpected)}")

    return [
        float(metrics[name])
        for name in FEATURE_ORDER
    ]
