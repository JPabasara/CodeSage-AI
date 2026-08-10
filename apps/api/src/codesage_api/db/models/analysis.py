"""ANALYSIS_ATTEMPT and SNAPSHOT (SAD §9 group 2; SRS DBR-6, DBR-7, DBR-22, DBR-23).

**The split between these two tables is the central decision of the data view.**

An *attempt* is the record that something was tried. A *snapshot* is the finalized,
immutable result of an attempt that succeeded. Every attempt gets a row; only a
successful one gets a snapshot.

Why they are not one table:

  * DBR-22 requires failed, cancelled and partially completed attempts to retain
    their status and diagnostic information while *never being presented as
    finalized results*. One table with a `phase` column makes that a filter every
    reader must remember; two tables make it structural — a query over SNAPSHOT
    cannot accidentally return a cancelled scan.
  * DBR-10's equivalent-analysis comparison must run against the last SUCCESSFUL
    analysis. With the split, "last successful" is just the newest snapshot; with
    one table it is a filter that, if forgotten, causes the system to skip work and
    then serve a snapshot that was never written.
  * FR-6 requires the previous snapshot to survive a cancellation. If the attempt
    and the result shared a row, a cancelled retry would overwrite the good one.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, TimestampMixin, UUIDPrimaryKey


class AnalysisAttempt(UUIDPrimaryKey, TimestampMixin, Base):
    """One execution attempt of the analysis pipeline — successful or not.

    This is the row the scan-status endpoint polls. `phase` lives here in
    PostgreSQL while the progress *percentage* lives in Redis, and the split
    follows from what each store guarantees: losing a percentage on a broker
    restart costs nothing because the next poll produces a new one, whereas losing
    the fact that a scan failed would break SRS SP-13, which requires the final
    phase and its error message to be recoverable from the database alone
    (SAD §6 decision 6).
    """

    __tablename__ = "analysis_attempt"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repository.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch: Mapped[str] = mapped_column(String(255), nullable=False)

    # The immutable revision this attempt analysed (DBR-7).
    commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    # The scanned commit's committer date. The 90-day churn window is measured back
    # from THIS, never from the scan time, so re-scanning a SHA always scores the
    # same (FR-11, REL-10).
    commit_committed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Which engine configuration ran — tools, rule set, extraction logic, models
    # (DBR-8, DBR-18).
    engine_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("analysis_engine_version.id", ondelete="RESTRICT"), nullable=True
    )

    # v1.0 has exactly one trigger: 'manual'. Scans are started by a user, never by
    # an event — there is no webhook endpoint (FR-6, SAD §1.2). The column exists
    # so that adding 'webhook' or 'scheduled' later is data, not a migration.
    trigger_type: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")

    phase: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Stored, not merely logged, so a user-reported failure is diagnosable from the
    # database without shell access to the workers (SRS SP-13, DBR-22).
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_attempt_repo_branch_created", "repository_id", "branch", "created_at"),
    )


class Snapshot(UUIDPrimaryKey, Base):
    """The immutable finalized result of a SUCCESSFUL analysis (DBR-22, DBR-23).

    Written once, in the transaction that finalizes the attempt, and never updated.
    That is what makes trend, history and delta queries over existing rows rather
    than updates to them — and it is why **a profile change never writes here**. A
    snapshot is keyed by commit SHA; a profile is not a commit. Were a profile
    change to insert a row, the trend chart would show a step on a day nobody
    touched the code (FR-14, FR-20, FR-21).

    Note what is absent: health_score, grade, delta. All three are functions of the
    active profile and are derived on read (FR-21, DBR-21).
    """

    __tablename__ = "snapshot"

    # One snapshot per successful attempt. The uniqueness is the invariant that
    # keeps "finalized result" and "attempt" from drifting apart.
    analysis_attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_attempt.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repository.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)

    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finding_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Denominator of repo_health. A stored fact about the commit, not a score.
    kloc: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)

    __table_args__ = (
        # The trend and scan-history query: snapshots for one repo+branch, newest first.
        Index("ix_snapshot_repo_branch_scanned", "repository_id", "branch", "scanned_at"),
    )
