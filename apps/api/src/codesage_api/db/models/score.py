"""Deletable, profile-stamped caches of derived snapshot summaries."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, UUIDPrimaryKey


class SnapshotScore(UUIDPrimaryKey, Base):
    __tablename__ = "snapshot_score"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"), index=True
    )
    profile_fingerprint: Mapped[str] = mapped_column(String(64))
    scoring_engine_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending"
    )
    health_score: Mapped[float | None] = mapped_column(Double)
    grade: Mapped[str | None] = mapped_column(String(1))
    debt_score: Mapped[float | None] = mapped_column(Double)
    kloc: Mapped[float | None] = mapped_column(Double)
    failure_information: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "snapshot_id",
            "profile_fingerprint",
            "scoring_engine_version",
            name="uq_snapshot_score_inputs",
        ),
        CheckConstraint(
            "health_score IS NULL OR (health_score >= 0 AND health_score <= 100)",
            name="health_score_range",
        ),
        CheckConstraint(
            "debt_score IS NULL OR debt_score >= 0", name="debt_score_nonnegative"
        ),
        CheckConstraint("kloc IS NULL OR kloc >= 0", name="kloc_nonnegative"),
        CheckConstraint(
            "status IN ('pending', 'running', 'ready', 'error')",
            name="status_value",
        ),
        CheckConstraint(
            "(status = 'ready' AND health_score IS NOT NULL AND grade IS NOT NULL "
            "AND debt_score IS NOT NULL AND kloc IS NOT NULL) OR status <> 'ready'",
            name="ready_values",
        ),
    )
