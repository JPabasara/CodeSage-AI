"""The ML-2 feature vector — owned here, imported by both training and inference.

**This module exists to prevent one specific bug.** If training and inference build
their feature vectors independently, a reordering or a renamed column produces no
error at all: the model receives well-formed floats in the wrong slots and returns
plausible risk scores computed from the wrong data. Nothing crashes, nothing logs,
and the numbers are quietly meaningless.

So the order is declared once, here, and both sides import it.
"""

from __future__ import annotations

#: CK product metrics. Names are CK's own, so training and inference read the same
#: vocabulary as the StaticMetric rows in PostgreSQL.
PRODUCT_FEATURES: tuple[str, ...] = (
    "wmc",
    "cbo",
    "dit",
    "lcom",
    "rfc",
    "noc",
    "loc",
    "max_nested_blocks",
    "comment_ratio",
)

#: The four PyDriller process metrics. Empirically the strongest predictors here —
#: churn beats complexity for defect prediction — which is why history mining is a
#: first-class stage of the pipeline rather than a side tool.
PROCESS_FEATURES: tuple[str, ...] = (
    "commits_90d",
    "author_count",
    "file_age_days",
    "recency_days",
)

FEATURE_ORDER: tuple[str, ...] = PRODUCT_FEATURES + PROCESS_FEATURES


def build_vector(metrics: dict[str, float]) -> list[float]:
    """Assemble one file's feature vector in FEATURE_ORDER.

    Missing metrics default to 0.0 rather than raising: CK does not emit every
    metric for every construct, and a scan must not fail because one file lacks a
    single measurement.
    """
    return [float(metrics.get(name, 0.0)) for name in FEATURE_ORDER]
