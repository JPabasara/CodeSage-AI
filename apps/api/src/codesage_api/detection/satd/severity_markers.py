"""SATD severity from comment markers (SRS FR-9.2, Appendix C.2).

The classifier predicts a category. This assigns the severity — and the split is
forced, not stylistic: a supervised model can only predict what its training data
labels, and SATDAUG labels categories, not severities. There is no answer key for
severity, so it has to come from somewhere deterministic.

Flat `medium` for every SATD finding was the obvious first answer and it is wrong:
`// FIXME: auth check is bypassed` and `// TODO: rename this variable` are not
equally bad.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from codesage_api.scoring.enums import Severity

_MARKERS = Path(__file__).parent / "markers.yaml"


@dataclass(frozen=True, slots=True)
class MarkerRule:
    precedence: int
    pattern: re.Pattern[str]
    severity: Severity
    base_points: int
    message_template: str


@lru_cache
def get_markers() -> tuple[tuple[MarkerRule, ...], MarkerRule]:
    """Returns (ordered markers, the no-marker default)."""
    raw = yaml.safe_load(_MARKERS.read_text(encoding="utf-8"))
    markers = tuple(
        sorted(
            (
                MarkerRule(
                    precedence=int(m["precedence"]),
                    pattern=re.compile(m["pattern"], re.IGNORECASE),
                    severity=Severity(m["severity"]),
                    base_points=int(m["base_points"]),
                    message_template=m["message_template"],
                )
                for m in raw["markers"]
            ),
            key=lambda m: m.precedence,
        )
    )
    d = raw["default"]
    default = MarkerRule(
        precedence=99,
        pattern=re.compile(r"(?!)"),  # never matches; the default is chosen by fallthrough
        severity=Severity(d["severity"]),
        base_points=int(d["base_points"]),
        message_template=d["message_template"],
    )
    return markers, default


def assign_severity(comment_text: str) -> MarkerRule:
    """Match the comment against the marker table; the highest-precedence hit wins.

    Evaluated high → medium → low, so "// FIXME: TODO later" is high. Patterns
    match anywhere in the comment, not only at the start, so "this is a temporary
    workaround" hits.

    No marker matched is NOT the same as not debt — the classifier already decided
    it was debt. A comment like "this whole module is a mess, sorry" carries no
    keyword at all, and catching it is exactly why ML-1 exists rather than a plain
    regex scan. Those fall through to the default, `medium`.
    """
    markers, default = get_markers()
    for marker in markers:
        if marker.pattern.search(comment_text):
            return marker
    return default
