

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


TERMINAL_PHASES: frozenset[ScanPhase] = frozenset(
    {ScanPhase.DONE, ScanPhase.ERROR, ScanPhase.CANCELLED}
)
