"""Canonical enum values — the vocabulary the whole system agrees on.

Lives inside `scoring` rather than `schemas` because the scoring package must not
import anything (see the import-linter contract in pyproject.toml), and both the
Pydantic schemas and the ORM columns can import *down* into it.

Normative sources: SRS v1.0 FR-8.2 (source), FR-9.3 + Appendix C.3 (category),
FR-6 (scan phase), FR-11 (severity base points).

⚠️ These MUST equal the values in `apps/web/src/lib/types/index.ts` (SRS SP-1).
That file is still at its pre-CR-001 state and disagrees with all three enums
below; it needs updating before the frontend is wired to the real backend.
"""

from __future__ import annotations

from enum import StrEnum


class Severity(StrEnum):
    """HOW BAD a finding is. Written once by the detector, never updated, never
    user-settable (SRS FR-8.1).

    Severity is 100% deterministic in v1.0: the rule register assigns it for rule
    findings, the marker table for SATD findings, and ML-2 assigns none because it
    produces no findings. No ML model and no user ever assigns a severity.

    Read by exactly two consumers — base-point lookup in scoring, and the badge
    colour in the UI — so the ranking and the badge can never disagree.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Source(StrEnum):
    """WHICH DETECTOR produced the finding. Exactly two values (SRS FR-8.2).

    `security` is not here: security patterns run inside the rule engine, so a
    security finding is a `rule` finding whose category is `security`. A separate
    `security` source would correlate perfectly with the category axis, collapsing
    two orthogonal axes into one.

    The risk model is not here either: ML-2 emits no findings at all, only a
    per-file risk score, so no FINDING row could ever carry such a value.
    """

    RULE = "rule"
    SATD = "satd"


class Category(StrEnum):
    """WHAT TYPE of debt it is. Exactly five values (SRS FR-9.3, Appendix C.3).

    Orthogonal to Source: a finding is always both *found by X* and *of type Y*.

    Four of the five are the SATDAUG comment-dataset labels, so the classifier
    trains and predicts on the same vocabulary the product uses:

        code-design   <- code/design_debt    (2,703)
        requirement   <- requirement_debt    (2,271)
        test          <- test_debt           (2,635)
        documentation <- documentation_debt  (2,701)

    `security` is the fifth and is NOT in the dataset — it is emitted by the rule
    engine alone and is never predicted. `non_debt` (58,204) is the negative class
    of the debt / not-debt decision and must never appear here.
    """

    CODE_DESIGN = "code-design"
    REQUIREMENT = "requirement"
    DOCUMENTATION = "documentation"
    TEST = "test"
    SECURITY = "security"


#: The four categories ML-1 may predict. `security` is excluded by construction —
#: it is not in the training data and only the rule engine emits it.
ML1_PREDICTABLE_CATEGORIES: frozenset[Category] = frozenset(
    {
        Category.CODE_DESIGN,
        Category.REQUIREMENT,
        Category.DOCUMENTATION,
        Category.TEST,
    }
)


class Grade(StrEnum):
    """A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40 (SRS FR-11)."""

    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"


class FindingStatus(StrEnum):
    """v1.0 is view-only: every finding is OPEN (SRS FR-17b).

    The later values are declared now because FR-11 sums "open finding priorities"
    — the filter needs something to filter on. The v1.1 accept / resolve /
    false-positive actions will add rows rather than change these ones.
    """

    OPEN = "open"
    ACCEPTED = "accepted"  # v1.1 — suppressed from the score
    RESOLVED = "resolved"  # v1.1
    FALSE_POSITIVE = "false-positive"  # v1.1


class ScanPhase(StrEnum):
    """The scan-control state machine (SRS FR-6).

        idle → queued → running NN% → done | error | cancelled

    CANCELLED is a distinct terminal phase, not a return to IDLE: FR-6 requires the
    previous snapshot to survive a cancellation, and DBR-22 requires the diagnostic
    record of a cancelled attempt to be retained while never being presented as a
    finalized result. Collapsing it into IDLE would lose that distinction.
    """

    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


#: Phases in which an analysis attempt has stopped for good.
TERMINAL_PHASES: frozenset[ScanPhase] = frozenset(
    {ScanPhase.DONE, ScanPhase.ERROR, ScanPhase.CANCELLED}
)
