"""Value types the scoring engine speaks in.

These are deliberately NOT the SQLAlchemy rows and NOT the Pydantic schemas.

That looks like duplication and is the opposite: it is what keeps `scoring` a pure
function (SAD G4, SRS SP-11). If the engine took ORM instances it would need a
session, a database and a running Postgres to test — and the TC-11 worked example
would stop being a unit test. Repositories map rows to these frozen dataclasses at
the boundary; the engine never learns where they came from.

Everything here is immutable. The engine derives; it never mutates its input.
"""

from __future__ import annotations

from dataclasses import dataclass

from codesage_api.scoring.enums import Category, Severity, Source


@dataclass(frozen=True, slots=True)
class ScoringFinding:
    """One stored finding, reduced to only what the formula reads.

    `severity` and `category` arrive already decided by the detector and are never
    recomputed here (SRS FR-8.1). The engine reads `severity` solely to look up its
    base points.
    """

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
    """Everything the engine derives in one pass. None of this is ever persisted."""

    findings: tuple[ScoredFinding, ...]  # ranked, floor applied
    files: tuple[ScoredFile, ...]
    breakdown: tuple[CategoryBreakdownItem, ...]
    health_score: float
    grade: str
