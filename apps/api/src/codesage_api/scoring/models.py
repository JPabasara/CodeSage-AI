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
    """The two per-file facts the scan stored, per SRS FR-21.

    `risk_score` is ML-2's output; `commits_90d` is the raw commit count over the
    window anchored to the *scanned commit's* committer date, never to now()
    (SRS FR-11). Both are properties of the code at that commit, which is why they
    are stored while everything derived from them is not — FR-21 stores "the raw
    commit counts from which the churn factor is computed", not the factor.
    """

    file: str
    risk_score: float  # 0.0 – 1.0
    commits_90d: int


@dataclass(frozen=True, slots=True)
class Profile:
    """The active scoring profile: five category weights plus one trust scalar.

    Carries no severity — that is the invariant that makes the visibility floor
    safe (SRS FR-8.1, FR-24, FR-20).

    Values are assumed already clamped; `services.profiles` clamps on write so the
    engine never has to defend itself against an out-of-range weight.
    """

    weights: dict[Category, float]  # one per Category value, each 0.1 – 3.0
    s: float  # 0.0 – 1.0, default 0.5


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
