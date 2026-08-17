"""Stage 2 — detection. Turns SIGNALS into FINDINGS, the atomic unit of output.

Three detectors doing fundamentally different jobs:

    rules/   RuleEngine    deterministic thresholds + security patterns → findings
    satd/    SATDClassifier (ML-1) → is this debt, and of what type → findings
    risk/    BugRiskModel   (ML-2) → per-file bug-proneness → NO findings

**`source` and `category` are orthogonal** (FR-8.2, FR-9.3). A finding is never
"either a rule finding or a debt-type finding" — it is both at once: *found by X,
classified as type Y*.

    source   = which detector found this?  → rule | satd
    category = what type of debt is it?    → code-design | requirement |
                                             documentation | test | security

    ┌──────────────┬─────────────────────────────────┬────────────────┐
    │ Rule engine  │ category hard-coded in the rule │ deterministic  │
    │ SATD (ML-1)  │ category predicted from text    │ ML             │
    │ Risk (ML-2)  │ assigns no category at all      │ it scores only │
    └──────────────┴─────────────────────────────────┴────────────────┘

**No ML model and no user ever assigns a severity** (FR-8.1). It is 100%
deterministic in v1.0: the rule register for rule findings, the marker table for
SATD findings, nothing at all for ML-2 because it produces no findings.

**The two ML models are independent and are not chained** (SAD §6 decision 10).
They take different inputs, produce different outputs and exchange no data, so an
implementation may issue both calls together. They also fail together, because
both live in one inference container — and when they do, the worker still persists
a valid snapshot: all rule and security findings present, no SATD findings, and
every risk score 0.0 so that risk_factor falls back to 1.0.
"""
