

from __future__ import annotations

from enum import StrEnum


class Severity(StrEnum):

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Source(StrEnum):


    RULE = "rule"
    SATD = "satd"


class Category(StrEnum):

    CODE_DESIGN = "code-design"
    REQUIREMENT = "requirement"
    DOCUMENTATION = "documentation"
    TEST = "test"
    SECURITY = "security"


ML1_PREDICTABLE_CATEGORIES: frozenset[Category] = frozenset(
    {
        Category.CODE_DESIGN,
        Category.REQUIREMENT,
        Category.DOCUMENTATION,
        Category.TEST,
    }
)


class Grade(StrEnum):

    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"


class FindingStatus(StrEnum):

    OPEN = "open"
    ACCEPTED = "accepted"  
    RESOLVED = "resolved" 
    FALSE_POSITIVE = "false-positive" 


class ScanPhase(StrEnum):


    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


class ScanStage(StrEnum):
    """Which part of the pipeline a running scan is in (13H.4).

    Reported next to `progress` so the client can label the wait and move its
    bar within the stage's band instead of sitting still between jumps.
    """

    CLONING = "cloning"
    READING_CODE = "reading_code"
    FINDING_DEBT = "finding_debt"
    PREDICTING_RISK = "predicting_risk"
    SCORING = "scoring"
    FINISHING = "finishing"


class ScanErrorCode(StrEnum):
    """Why a scan ended in `error`, for the failures a user can act on.

    Absent for an unexpected failure; the stored `error` sentence covers that.
    """

    NO_JAVA_FILES = "NO_JAVA_FILES"
    REPOSITORY_TOO_LARGE = "REPOSITORY_TOO_LARGE"
    SCAN_TIMED_OUT = "SCAN_TIMED_OUT"


TERMINAL_PHASES: frozenset[ScanPhase] = frozenset(
    {ScanPhase.DONE, ScanPhase.ERROR, ScanPhase.CANCELLED}
)
