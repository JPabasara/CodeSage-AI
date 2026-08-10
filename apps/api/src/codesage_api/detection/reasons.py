"""The one-line reason — deterministic templates, no NLP (SRS FR-16).

The part that sounds hardest is the easiest. Every real static-analysis tool
generates these messages with string templates, not AI. The reason is not
*generated*; it is a template attached to each rule with the finding's own data
interpolated into the blanks.

    rule_id = complex-function          "{symbol}() has cyclomatic complexity
    symbol  = charge                     {value}, over the limit of {threshold}
    value   = 18                    +    - split it into smaller functions."
    threshold = 15
                            ↓
    "charge() has cyclomatic complexity 18, over the limit of 15 - split it
     into smaller functions."

Pure string formatting. When a rule fires it already knows the symbol, the
measured value and its own threshold, so filling the template is one line. The
result is reliable (never hallucinates), explainable (you know exactly why each
line appears), instant and free.

For a debt tool, deterministic is *better* than AI-generated here: you never want
a fix hint that confidently lies. The differentiator is not AI prose — it is that
every rule has a plain-English explanation attached at all, where other tools emit
a bare rule id. A curation effort, not a modelling problem.

Do not confuse this with an AI **fix suggestion**, which rewrites the offending
code and needs a generative model. v1.0 commits only to the explanation.
"""

from __future__ import annotations


def render_rule_reason(template: str, *, symbol: str, file: str, value: float, threshold: float) -> str:
    """Interpolate a rule's message template (Appendix C.1)."""
    raise NotImplementedError


def render_satd_reason(template: str, *, comment_text: str, predicted_category: str) -> str:
    """Interpolate a SATD marker's message template (Appendix C.2).

    Quotes the comment already extracted, next to the label the model returned —
    no generation at all. The marker table sets the severity AND selects the
    wording ("Self-admitted defect" / "debt" / "note"), so the sentence a user
    reads matches the badge beside it.

    Long comments are truncated for the list row; the full text stays on the
    finding as stored evidence.
    """
    raise NotImplementedError


def render_risk_badge(risk_score: float, indicators: list[str]) -> str:
    """The per-file risk badge (Appendix C.3, Table 4.34).

    E.g. "High-risk file (0.78): high complexity (WMC 18) and frequent change
    (14 commits/90d)."

    Surfaces the salient raw signals — notable feature values, NOT a causal
    breakdown. It is a badge on a file, never a row in the Refactor-First list,
    because ML-2 produces no findings and a file-level score does not tell anyone
    which line to go fix.
    """
    raise NotImplementedError
