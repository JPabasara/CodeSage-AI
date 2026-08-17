"""SATDAUG label ↔ product category mapping (SRS FR-9.3, Appendix C.3).

The model trains on the dataset's own label strings and this mapping is applied to
its output, so the rename is deterministic and cannot affect trainability.

    code/design_debt     → code-design      2,703
    requirement_debt     → requirement      2,271
    test_debt            → test             2,635
    documentation_debt   → documentation    2,701
    non_debt             → (negative class) 58,204

**`non_debt` is the negative class, not a category.** It answers "is this debt at
all?" and must never reach the Category enum or a weight slider.

**`security` has no dataset label.** It is not in the training data and is emitted
by the rule engine alone — the classifier can never predict it. That is why the
model is a four-class problem while the product has five categories.

**Imbalance to state honestly:** only a small fraction of comments are debt at all,
so FR-25 requires PER-CLASS precision/recall/F1 with support counts. A single
macro- or weighted-average figure would hide poor performance on the smaller
classes.
"""

from __future__ import annotations

#: Dataset label → product category value. The only place this mapping exists.
DATASET_TO_CATEGORY: dict[str, str] = {
    "code/design_debt": "code-design",
    "requirement_debt": "requirement",
    "test_debt": "test",
    "documentation_debt": "documentation",
}

#: The negative class. Never a category.
NON_DEBT_LABEL = "non_debt"

#: Emitted by the rule engine only; never predicted.
RULE_ONLY_CATEGORIES = frozenset({"security"})


def to_category(dataset_label: str) -> str | None:
    """Map a model output to a product category, or None for the negative class."""
    if dataset_label == NON_DEBT_LABEL:
        return None
    return DATASET_TO_CATEGORY[dataset_label]
