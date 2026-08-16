"""The dashboard payload (SRS FR-12 – FR-18).

Every number in these shapes is DERIVED on this request under the active profile.
None of them is read from a column.
"""

from __future__ import annotations

from typing import Literal

from codesage_api.schemas.base import ApiModel
from codesage_api.schemas.finding import FindingOut
from codesage_api.scoring.enums import Category, Grade


class FileScoreOut(ApiModel):
    file: str
    debt_score: float  # derived: Σ finding priorities in this file
    risk_score: float  # stored fact: ML-2's output, 0–1


class TreeNodeOut(ApiModel):
    """A node in the hotspot heat map (FR-18).

    Folder health is the aggregation of the stored file scores beneath it, so
    drilling in re-aggregates a subtree — summing numbers already in memory, with
    no re-scan and no second query. Repo health is this same aggregation at the root.
    """

    path: str
    name: str
    type: Literal["file", "folder"]
    health_score: float
    grade: Grade
    debt_score: float
    risk_score: float
    children: list[TreeNodeOut] | None = None


class HealthPointOut(ApiModel):
    """One point on the trend chart (FR-14)."""

    t: str  # ISO timestamp
    score: float
    commit_sha: str | None = None


class CategoryBreakdownItemOut(ApiModel):
    """One slice of the category pie (FR-13).

    `count` is a plain query over stored rows. `debt` is weighted by the active
    profile, so the two move independently — a category can hold many findings and
    little debt, or the reverse.
    """

    category: Category
    count: int
    debt: float


class HealthReportOut(ApiModel):
    """The complete dashboard payload for one branch snapshot."""

    # The SNAPSHOT, not the attempt that made it. A cancelled or failed attempt
    # has a scan id but no snapshot, so the dashboard is always keyed on the
    # thing that actually exists (locked decision 9).
    snapshot_id: str
    repo_id: str
    branch: str
    commit_sha: str
    scanned_at: str

    health_score: float
    grade: Grade
    delta: float  # vs the previous snapshot, both scored under the active profile
    red_issue_count: int  # critical + high, for the health-card summary

    # The active profile's name, shown on the trend chart. Always truthful because
    # there is exactly one active profile per workspace to name; "custom" when the
    # user has adjusted away from a preset.
    profile: str

    # Which ML model produced this snapshot (AI-03, DBR-18). Null when the scan
    # ran in degraded mode with no ML available — which is a real state, not an
    # error, so it has to be expressible.
    model_version: str | None = None

    history: list[HealthPointOut]
    tree: list[TreeNodeOut]
    file_scores: list[FileScoreOut]
    findings: list[FindingOut]
    category_breakdown: list[CategoryBreakdownItemOut]
