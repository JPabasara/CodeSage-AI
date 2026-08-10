"""FINDING and per-file fact queries — the read path's data source.

These return the frozen scoring dataclasses, not ORM rows. That mapping at the
boundary is what lets `scoring` stay import-pure and unit-testable with no
database (SRS SP-11).
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.scoring.models import FileFacts, ScoringFinding


def list_open_findings(session: Session, snapshot_id: uuid.UUID) -> list[ScoringFinding]:
    """Every OPEN finding for one snapshot, mapped into scoring's value types.

    In v1.0 every finding is open, so the filter is a no-op today. It is written
    now because FR-11 defines health over *open* priorities and v1.1's accept /
    resolve / false-positive actions will start moving rows off that status — at
    which point a missing WHERE clause becomes a silent scoring bug.

    Joins DEBT_CATEGORY to resolve `category_id` into the Category enum value, and
    SOURCE_FILE for the path the scoring engine groups by.
    """
    raise NotImplementedError


def list_file_facts(session: Session, snapshot_id: uuid.UUID) -> dict[str, FileFacts]:
    """Per-file risk_score and commits_90d for one snapshot, keyed by path.

    Reads SOURCE_FILE.risk_score (denormalised from BUG_RISK_PREDICTION for exactly
    this query) joined to PROCESS_METRIC.commits_90d. Two stored facts; the churn
    and risk *factors* derived from them are computed in Python.
    """
    raise NotImplementedError


def category_counts(session: Session, snapshot_id: uuid.UUID) -> dict[str, int]:
    """Raw per-category finding counts — the un-weighted half of the breakdown.

    The debt half is weighted by the active profile, so it cannot be computed here;
    it comes from ScoringEngine. This exists for the count column and for the
    debt-type filter (FR-15), which is a plain WHERE over stored rows and needs no
    scoring at all.
    """
    raise NotImplementedError


def bulk_insert(session: Session, snapshot_id: uuid.UUID, rows: list[dict]) -> int:
    """Write detection output. Called once, inside the finalization transaction.

    Bulk insert rather than per-row ORM adds: a large repository produces tens of
    thousands of findings and this runs inside the transaction that makes the
    snapshot visible, so its duration is time the snapshot does not exist.
    """
    raise NotImplementedError
