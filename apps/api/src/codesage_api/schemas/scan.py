"""Scan lifecycle wire shapes (SRS FR-6, FR-19)."""

from __future__ import annotations

from pydantic import Field

from codesage_api.schemas.base import ApiModel
from codesage_api.scoring.enums import Grade, ScanErrorCode, ScanPhase, ScanStage


class StartScanIn(ApiModel):
    branch: str


class ScanStatusOut(ApiModel):
    """What the client polls once per second. """
    scan_id: str
    phase: ScanPhase
    progress: int = Field(ge=0, le=100)
    branch: str | None = None
    commit_sha: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    # Why it failed, when the reason is one the user can act on (13H.1). Absent
    # for unexpected failures and for every phase but `error`.
    error_code: ScanErrorCode | None = None
    # 13H.4, all optional and only while `running`: which stage the worker is
    # in, how many Java files it has read so far, and how long this repository's
    # recent scans usually took. Older clients ignore them.
    stage: ScanStage | None = None
    files_done: int | None = Field(default=None, ge=0)
    files_total: int | None = Field(default=None, ge=0)
    typical_seconds: int | None = Field(default=None, ge=0)


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
