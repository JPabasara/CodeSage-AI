"""DashboardService — assembles the read path (SRS FR-12 – FR-18).

Stored facts + the active profile → ScoringEngine → the payload. This module is
where the two halves meet, and it is the only place they do.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.schemas import HealthReportOut, ScanSummaryOut


def build_health_report(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID, branch: str
) -> HealthReportOut:
    """The full dashboard payload for the latest snapshot on a branch.

    Sequence:
        1. resolve the latest finalized Snapshot for (repo, branch)
        2. read its open findings and per-file facts — one query each
        3. resolve the workspace's active profile
        4. hand all three to ScoringEngine
        5. shape what it returns into the wire model

    Step 4 is where every number on screen is produced. Steps 1–3 return facts
    only. Nothing derived is written back at any point, which is what lets a
    profile change re-score instantly and never re-scan.

    A dashboard read is therefore one database round trip plus an in-memory
    scoring pass — a few thousand multiply-adds for a typical snapshot.
    """
    raise NotImplementedError


def build_trend(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID, branch: str
) -> list[dict]:
    """The trend chart: health per snapshot over time (FR-14).

    **Every point is scored under the CURRENTLY active profile**, not under
    whatever was active when each scan ran. Switching profiles therefore redraws
    the entire line, and every point stays comparable.

    Mixing profiles along one line is prohibited: the reader could not tell a code
    change from a settings change, which would make the chart actively misleading.
    """
    raise NotImplementedError


def build_scan_history(
    session: Session, workspace_id: uuid.UUID, repository_id: uuid.UUID, branch: str
) -> list[ScanSummaryOut]:
    """Scan history rows (FR-19). Score, grade and delta derived per row."""
    raise NotImplementedError
