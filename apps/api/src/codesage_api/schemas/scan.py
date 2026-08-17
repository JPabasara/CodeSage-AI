"""Scan lifecycle wire shapes (SRS FR-6, FR-19)."""

from __future__ import annotations

from pydantic import Field

from codesage_api.schemas.base import ApiModel
from codesage_api.scoring.enums import Grade, ScanPhase


class StartScanIn(ApiModel):
    branch: str


class ScanStatusOut(ApiModel):
    """What the client polls once per second.

    `phase` comes from PostgreSQL and `progress` from Redis — see the note in
    `routers/scans.py` on why those two live in different stores.
    """

    scan_id: str
    phase: ScanPhase
    progress: int = Field(ge=0, le=100)
    branch: str | None = None
    commit_sha: str | None = None
    started_at: str | None = None
    finished_at: str | None = None

    # Present when phase is ERROR. Read from the stored failure reason, not from
    # logs, so a user-reported failure is diagnosable without shell access.
    error: str | None = None


class ScanSummaryOut(ApiModel):
    """One row in the Scan-History view (FR-19).

    Only the stored fields are stored. Health, grade and delta are derived under
    the active profile on every request, which is why switching profiles redraws
    this list too.

    Two identifiers, deliberately (locked decision 9). `scan_id` is the attempt —
    the thing that ran. `snapshot_id` is what it produced. Only attempts that
    finished have one, so carrying both is what lets the client link a row to its
    dashboard without guessing that the two ids are interchangeable.
    """

    snapshot_id: str
    scan_id: str
    branch: str
    commit_sha: str
    scanned_at: str
    finding_count: int

    health_score: float
    grade: Grade
    delta: float
