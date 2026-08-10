"""Stage 1 — extraction. Produces SIGNALS, never findings.

A signal is a measurement, not debt: WMC 18 is not debt, it is *evidence* of debt
that the next stage may or may not turn into a finding.

Three extractors, three kinds of signal (SRS FR-7):

    ck_metrics       — CK          → static Java metrics per class and method
    process_metrics  — PyDriller   → four numbers per file from the history
    comments         — Tree-sitter → source comments at the scanned SHA

**The extraction boundary** (FR-7.1), which governs all three:

    Git history enters the pipeline as numbers, never as text.

Text produces findings, and a finding must land on a `file:line` the user can
open — so text is read from the checked-out tree at the scanned commit. History
produces metrics, so it may look backwards, but only as a numeric feature vector.

    Source comments at the scanned SHA      ✓ SATD classifier reads these
    Source files at the scanned SHA         ✓ CK, then the rule engine and ML-2
    Commit history reachable from that SHA  ✓ but only as four numbers
    Commit message text                     ✗ no file:line to point at
    Pull requests, issues, API metadata      ✗ the pipeline runs off a clone
    Previously stored snapshots              ✗ read only for trends and deltas

The consequence the architecture leans on: **a scan is a pure function of the
repository at one commit.** It depends on the tree and reachable history at that
SHA plus a fixed engine version, never on a previous attempt row. That is what
makes skip-if-unchanged sound and snapshots reproducible (REL-10).
"""
