"""The rule engine — the deterministic backbone (SRS FR-8).

One engine, one pass, one code path, two mechanisms:

  * **metric rules** compare a CK measurement against a threshold
  * **security patterns** match a regex or an entropy test against source text

That is a difference of mechanism, not of detector, which is why `source` has no
`security` value: a security finding is a rule finding whose category is
`security` (FR-8.2).

Fully explainable, never wrong in a way you cannot trace, and — importantly for
the schedule — it ships and works on its own. If the ML slips, this engine still
produces a usable report.
"""

from __future__ import annotations

from codesage_api.detection.rules.registry import RuleDefinition
from codesage_api.extractors.ck_metrics import FileMetrics


def detect(files: list[FileMetrics], rules: list[RuleDefinition]) -> list[dict]:
    """Evaluate every rule against every file and symbol.

    Returns finding dicts carrying, per FR-8: file, line, symbol, category,
    severity, the measured value, the threshold crossed, and the rule id. The
    measured value and threshold are stored as evidence *and* interpolated into the
    reason template, so what the user reads and what the database holds cannot
    disagree.

    Deterministic by construction: same inputs, same findings, in the same order.
    That is what makes regression tests exact rather than statistical (SUP-04).
    """
    raise NotImplementedError
