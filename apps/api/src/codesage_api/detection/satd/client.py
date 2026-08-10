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

    Every result is returned, including `is_debt = False` ones. Those produce no
    finding but are still stored as SATDPrediction rows, which is what lets the
    FR-25 evaluation run against real traffic instead of only the held-out set.

    Raises MLServiceUnavailable if the inference container does not answer within
    the configured budget. The caller degrades rather than fails: the snapshot is
    persisted with rule findings only (SAD §6 decision 11).
    """
    raise NotImplementedError
