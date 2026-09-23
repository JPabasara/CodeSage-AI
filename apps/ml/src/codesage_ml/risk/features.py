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

    Missing features default to 0.0 so newly created files or unavailable
    history produce a complete numeric vector.
    """
    return [
        float(metrics.get(name, 0.0))
        for name in FEATURE_ORDER
    ]