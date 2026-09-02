

from __future__ import annotations

from dataclasses import dataclass

from codesage_api.scoring.enums import Category, Severity, Source


@dataclass(frozen=True, slots=True)
class ScoringFinding:


    fingerprint: str
    source: Source
    category: Category
    severity: Severity
    file: str


@dataclass(frozen=True, slots=True)
class FileFacts:
    file: str
    risk_score: float
    commits_90d: int
    loc: int


@dataclass(frozen=True, slots=True)
class Profile:
    weights: dict[Category, float]
    s: float  # 0.0
    name: str = "custom"

@dataclass(frozen=True, slots=True)
class ScoredFinding:
    finding: ScoringFinding
    priority: float
    pinned_by_floor: bool = False


@dataclass(frozen=True, slots=True)
class ScoredFile:
    file: str
    debt_score: float
    risk_score: float
    health_score: float


@dataclass(frozen=True, slots=True)
class CategoryBreakdownItem:
    category: Category
    count: int
    debt: float


@dataclass(frozen=True, slots=True)
class ScoringResult:

    findings: tuple[ScoredFinding, ...]  # ranked, floor applied
    files: tuple[ScoredFile, ...]
    breakdown: tuple[CategoryBreakdownItem, ...]
    health_score: float
    grade: str
