"""Finding wire shape."""

from __future__ import annotations

from typing import Literal

from codesage_api.schemas.base import ApiModel
from codesage_api.scoring.enums import Category, FindingStatus, Severity, Source


class FindingOut(ApiModel):
    """One detected issue as the dashboard receives it.

    `severity` and `category` are the stored values, rendered as badges. The client
    performs no judgement — it maps the severity string to a colour token, nothing
    more. This is the "dashboard computes nothing" invariant applied to severity:
    the badge and the ranking read the same stored string, so they cannot disagree.

    `priority` IS computed, on every request, under the active profile. It is here
    as the sort key the list is already ordered by, so the client never re-sorts.
    """

    fingerprint: str
    source: Source
    category: Category
    severity: Severity
    file: str
    source_scope: Literal["production", "test", "generated", "example", "unknown"] = "unknown"
    line: int
    end_line: int | None = None
    symbol: str | None
    reason: str
    status: FindingStatus
    change_status: Literal["new", "unchanged"] = "new"

    priority: float

    pinned_by_floor: bool = False

    # Rule findings: the evidence interpolated into the reason.
    rule_id: str | None = None
    metric_value: float | None = None
    threshold: float | None = None

    # SATD findings: the comment that produced this, and the classifier's confidence.
    comment_text: str | None = None
    confidence: float | None = None


class FindingPageOut(ApiModel):
    """One stable slice of the score-ranked findings for a snapshot."""

    items: list[FindingOut]
    total: int
    limit: int
    offset: int


class FindingStatusIn(ApiModel):
    """`PUT /api/snapshots/{snapshot_id}/findings/{fingerprint}/status`.

    Kept as a plain string so an unsupported value answers the contract's
    VALIDATION_FAILED envelope rather than FastAPI's generic 422 body.
    """

    status: str
