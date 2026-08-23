"""ML-1 client: comments in, debt/not-debt + category out (SRS FR-9).

The classifier predicts a category from {code-design, requirement, documentation,
test} — four of the five. `security` is never predicted: it is not in the training
data and only the rule engine emits it (FR-9.3).

It does not predict severity. That comes from the marker table.
"""

from __future__ import annotations

from dataclasses import dataclass

from codesage_api.extractors.comments import ExtractedComment
from codesage_api.scoring.enums import Category


import httpx

from codesage_api.config import get_settings
from codesage_api.errors import MLServiceUnavailable
from codesage_api.extractors.comments import ExtractedComment
from codesage_api.scoring.enums import Category

CATEGORY_MAP: dict[str, Category] = {
    "code/design_debt": Category.CODE_DESIGN,
    "code-design": Category.CODE_DESIGN,
    "requirement_debt": Category.REQUIREMENT,
    "requirement": Category.REQUIREMENT,
    "documentation_debt": Category.DOCUMENTATION,
    "documentation": Category.DOCUMENTATION,
    "test_debt": Category.TEST,
    "test": Category.TEST,
}


@dataclass(frozen=True, slots=True)
class SATDResult:
    comment: ExtractedComment
    is_debt: bool
    category: Category | None  # None when is_debt is False
    confidence: float


def classify(comments: list[ExtractedComment]) -> list[SATDResult]:
    """Batch-classify comments.

    Batched rather than per-comment because a large repository has tens of
    thousands of comments and the round-trip cost would dominate the scan.
    """
    if not comments:
        return []

    settings = get_settings()
    url = f"{settings.ml_service_url.rstrip('/')}/classify"

    # Map ExtractedComment list to payload items with indexed IDs
    comment_map = {f"c_{i}": comment for i, comment in enumerate(comments)}
    payload = {
        "comments": [
            {"id": cid, "text": comment.text}
            for cid, comment in comment_map.items()
        ]
    }

    try:
        response = httpx.post(url, json=payload, timeout=30.0)
        response.raise_for_status()
    except (httpx.HTTPError, Exception) as exc:
        raise MLServiceUnavailable(f"Failed to connect to ML service: {exc}") from exc

    data = response.json()
    predictions = data.get("predictions", [])

    results: list[SATDResult] = []
    for pred in predictions:
        cid = pred["id"]
        comment = comment_map[cid]
        is_debt = pred["is_debt"]
        cat_str = pred.get("category")
        category = CATEGORY_MAP.get(cat_str) if cat_str else None
        confidence = float(pred.get("confidence", 1.0))

        results.append(
            SATDResult(
                comment=comment,
                is_debt=is_debt,
                category=category,
                confidence=confidence,
            )
        )

    return results
