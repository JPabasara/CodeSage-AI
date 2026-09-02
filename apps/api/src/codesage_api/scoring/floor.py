
from __future__ import annotations

from dataclasses import replace

from codesage_api.scoring.enums import Category, Severity
from codesage_api.scoring.models import ScoredFinding


def is_floored(finding: ScoredFinding) -> bool:
    
    return (
        finding.finding.category is Category.SECURITY
        and finding.finding.severity is Severity.CRITICAL
    )


def apply_visibility_floor(ranked: list[ScoredFinding]) -> list[ScoredFinding]:

    pinned: list[ScoredFinding] = []
    remaining: list[ScoredFinding] = []

    for finding in ranked:
        if is_floored(finding):
            pinned.append(replace(finding, pinned_by_floor=True))
        else:
            remaining.append(finding)

    return pinned + remaining
