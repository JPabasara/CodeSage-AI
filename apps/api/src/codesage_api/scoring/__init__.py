"""Scoring — the pure, dependency-free core (SAD §5.2, §9 · SRS FR-11, FR-20, FR-21).

This package must not import the database, the web framework, the queue, or any
I/O library. That rule is enforced by the `scoring is pure` contract in
pyproject.toml; run `lint-imports` to check it.

The reason is not neatness. FR-20's promise — *change a profile, re-rank instantly,
never re-scan* — is only deliverable if no score is ever stored, and SP-11's
"exactly testable" is only deliverable if this runs with nothing else running.
"""

from codesage_api.scoring.engine import score
from codesage_api.scoring.enums import (
    ML1_PREDICTABLE_CATEGORIES,
    TERMINAL_PHASES,
    Category,
    FindingStatus,
    Grade,
    ScanPhase,
    Severity,
    Source,
)
from codesage_api.scoring.models import (
    FileFacts,
    Profile,
    ScoredFile,
    ScoredFinding,
    ScoringFinding,
    ScoringResult,
)

__all__ = [
    "ML1_PREDICTABLE_CATEGORIES",
    "TERMINAL_PHASES",
    "Category",
    "FileFacts",
    "FindingStatus",
    "Grade",
    "Profile",
    "ScanPhase",
    "ScoredFile",
    "ScoredFinding",
    "ScoringFinding",
    "ScoringResult",
    "Severity",
    "Source",
    "score",
]
