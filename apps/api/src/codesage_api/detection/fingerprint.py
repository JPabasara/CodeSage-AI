"""Stable finding identity across scans (SRS DBR-15).

A fingerprint lets the system say whether a finding is new, unchanged or resolved
between two analyses — which is what makes `delta` and the trend chart mean
something rather than just counting rows.

**The line number is deliberately excluded.** Adding an import at the top of a file
shifts every line below it; if the fingerprint included the line, every finding in
that file would read as "resolved, and a new one appeared", and the delta would
show a cliff on a commit that changed nothing of substance.
"""

from __future__ import annotations

from codesage_api.scoring.enums import Source


def rule_fingerprint(rule_id: str, file_path: str, symbol: str) -> str:
    """Identity of a rule finding: (rule, file, symbol).

    Two `complex-function` findings on two different methods of the same class are
    distinct; the same method still over the threshold next week is the same
    finding, even if it moved down 40 lines or its WMC went from 18 to 24.
    """
    raise NotImplementedError


def satd_fingerprint(file_path: str, comment_text: str) -> str:
    """Identity of a SATD finding: (file, normalised comment text).

    Keyed on the text because that is what the developer actually wrote and what
    disappears when they fix it. Normalisation collapses whitespace and strips the
    comment delimiters, so reflowing a comment across two lines does not resurrect
    it as new.

    This is what makes comment SATD self-healing: delete the `// TODO`, the next
    scan does not produce this fingerprint, the finding is resolved, health rises.
    """
    raise NotImplementedError


def build(source: Source, **parts: str) -> str:
    """Dispatch to the right fingerprint function for the finding's source."""
    raise NotImplementedError
