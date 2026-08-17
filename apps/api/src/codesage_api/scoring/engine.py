"""ScoringEngine — the pure function at the centre of the architecture.

Stored findings + stored per-file facts + the active profile  →  every number the
dashboard displays. Nothing here is ever written back (SRS FR-21).

**Where this is called from.** The API process, on the READ path, every time the
dashboard is requested. Never by a Celery worker: the write path ends at "persist
the snapshot" (SAD Figure 5). The import-linter contract `workers never score` in
pyproject.toml enforces that mechanically.

**Why it is pure.** Four requirements collapse into this one property:

  * FR-20 promises a profile change re-scores instantly with no re-scan. Only
    possible if no score was stored in the first place.
  * FR-21 keeps snapshots append-only, which the trend chart depends on. A stored
    score would have to be UPDATEd when a weight moved, breaking that.
  * SP-11 requires the scoring path to be exactly testable — this function runs
    against the TC-11 fixture with no database at all.
  * SP-8 keeps thresholds in configuration; a Python function reads config
    naturally, while a SQL view would turn recalibration into a migration.

**Why the arithmetic is in Python and not SQL.** The formula has five factors,
bounded ranges and a visibility-floor override; expressed in SQL it becomes hard
to read and harder to change. If read latency ever becomes a *measured* problem,
the fix is to have Postgres pre-aggregate the per-(category, source) sums — at most
5 × 2 = 10 groups — and still apply the weights here, keeping the formula in one
testable place. SAD §9 states this explicitly as an optimisation to consider only
on evidence; it is not part of the v1.0 design.
"""

from __future__ import annotations

from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding, ScoringResult


def score(
    findings: list[ScoringFinding],
    file_facts: dict[str, FileFacts],
    profile: Profile,
    kloc: float,
) -> ScoringResult:
    """Derive priorities, file debt, health, grade and the category breakdown.

    Args:
        findings: stored OPEN findings for one snapshot. In v1.0 every finding is
            open (FR-17c); the filter exists because FR-11 sums *open* priorities
            and v1.1 will start moving findings off that status.
        file_facts: per-file risk_score and commits_90d, keyed by path.
        profile: the workspace's active profile, already clamped on write.
        kloc: snapshot size, for the health denominator.

    Steps:
        1. priority per finding                    → formula.finding_priority
        2. Σ per file                              → file debt, then the tree tint
        3. Σ over files ÷ (k × KLOC)               → repo health, then grade
        4. group by category                       → the breakdown pie
        5. pin critical security findings          → floor.apply_visibility_floor

    A file present in `file_facts` but carrying no findings scores zero debt and
    renders green, even at risk 0.95. That is required by FR-10: every point of
    debt must trace to a finding a user can open. Risk stays visible as its own
    badge rather than inventing debt with no clickable line.
    """
    raise NotImplementedError


def aggregate_subtree(files: list[str], result: ScoringResult) -> float:
    """Re-aggregate health for a folder from the file scores already derived.

    Drill-in is a sum over numbers that are already in memory — no re-scan, no
    second query. Repo health is this same aggregation at the root.
    """
    raise NotImplementedError
