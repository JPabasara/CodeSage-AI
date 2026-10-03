"""The cached dashboard payload produced by the Celery scoring worker."""

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

    snapshot_id: str
    repo_id: str
    branch: str
    commit_sha: str
    scanned_at: str

    health_score: float
    grade: Grade
    delta: float  # vs the previous snapshot, both scored under the active profile
    red_issue_count: int  # critical + high, for the health-card summary
    resolved_finding_count: int = 0

    profile: str
    include_test_findings: bool = False

    model_version: str | None = None

    history: list[HealthPointOut]
    tree: list[TreeNodeOut]
    file_scores: list[FileScoreOut]
    findings: list[FindingOut]
    category_breakdown: list[CategoryBreakdownItemOut]


class CalibrationCountsOut(ApiModel):
    severity: dict[str, int]
    category: dict[str, int]
    source: dict[str, int]


class CalibrationRecordOut(ApiModel):
    """One completed repository observation accepted by calibration.health."""

    repository_id: str
    commit_sha: str
    status: Literal["ready"] = "ready"
    debt_score: float
    kloc: float
    counts: CalibrationCountsOut
    provenance: dict[str, object]
