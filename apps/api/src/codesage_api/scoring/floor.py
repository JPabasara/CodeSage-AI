"""The critical-security visibility floor — SRS FR-24, mechanism 3.

The floor is delivered by three mechanisms working together, not by one check:

1. **Severity is not user-configurable.** `hardcoded-secret = critical` is fixed
   in the rule register, so no profile control can reach it.
2. **Security bypasses the trust slider.** `source_trust` is pinned at 1.0 for the
   security category, so no position of `s` can de-weight it.
3. **This module.** Critical security findings are pinned into the visible list
   regardless of computed priority.

Mechanisms 1 and 2 are structural — they hold by construction and cannot be
forgotten. Mechanism 3 is an explicit step, which is exactly why it needs its own
test (SRS TC-24).

⚠️ Why this file exists at all: while profiles were preset-only, the floor held by
construction because no preset set the security weight low enough to matter. Once
FR-20 exposed a slider a user can drag to 0.1, the guarantee stopped being
structural. A sentence in the SRS is no longer sufficient — it has to be code.
"""

from __future__ import annotations

from dataclasses import replace

from codesage_api.scoring.enums import Category, Severity
from codesage_api.scoring.models import ScoredFinding


def is_floored(finding: ScoredFinding) -> bool:
    """A critical security finding: the one thing no profile may bury."""
    return (
        finding.finding.category is Category.SECURITY
        and finding.finding.severity is Severity.CRITICAL
    )


def apply_visibility_floor(ranked: list[ScoredFinding]) -> list[ScoredFinding]:
    """Pin critical security findings to the head of the ranked list.

    A delivery-speed profile may legitimately de-prioritise a long method. It must
    never hide a leaked credential.

    Returns a new list; relative order is preserved within both groups, and
    `pinned_by_floor` is set so the UI can explain why a row sits where it does
    rather than appearing to contradict its own priority number.
    """
    pinned: list[ScoredFinding] = []
    remaining: list[ScoredFinding] = []

    for finding in ranked:
        if is_floored(finding):
            pinned.append(replace(finding, pinned_by_floor=True))
        else:
            remaining.append(finding)

    return pinned + remaining
