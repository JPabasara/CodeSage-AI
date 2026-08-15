from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import AnalysisStatus, AnalysisTriggerType

if TYPE_CHECKING:
    from codesage_api.db.models.provenance import AnalysisEngineVersion
    from codesage_api.db.models.repository import Branch
    from codesage_api.db.models.source import FileTreeNode, SourceFile


def values(enum: type[AnalysisStatus] | type[AnalysisTriggerType]) -> list[str]:
    return [item.value for item in enum]


class AnalysisAttempt(UUIDPrimaryKey, Base):
    __tablename__ = "analysis_attempt"

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branch.id", ondelete="CASCADE"), index=True)
    analysis_engine_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analysis_engine_version.id", ondelete="RESTRICT"), index=True)
    commit_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    trigger_type: Mapped[AnalysisTriggerType] = mapped_column(Enum(AnalysisTriggerType, name="analysis_trigger_type", values_callable=values))
    status: Mapped[AnalysisStatus] = mapped_column(Enum(AnalysisStatus, name="analysis_status", values_callable=values), index=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    failure_information: Mapped[str | None] = mapped_column(Text)
    branch: Mapped[Branch] = relationship(back_populates="analysis_attempts")
    analysis_engine_version: Mapped[AnalysisEngineVersion] = relationship(back_populates="analysis_attempts")
    snapshot: Mapped[Snapshot | None] = relationship(back_populates="analysis_attempt", uselist=False, passive_deletes=True)

    __table_args__ = (
        CheckConstraint("retry_count >= 0", name="retry_count_nonnegative"),
        CheckConstraint("completion_time IS NULL OR start_time IS NULL OR completion_time >= start_time", name="valid_time_range"),
        Index("ix_analysis_attempt_branch_commit", "branch_id", "commit_sha"),
    )


class Snapshot(UUIDPrimaryKey, Base):
    __tablename__ = "snapshot"

    analysis_attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analysis_attempt.id", ondelete="CASCADE"), unique=True)
    commit_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    scan_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finding_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    analysis_attempt: Mapped[AnalysisAttempt] = relationship(back_populates="snapshot")
    source_files: Mapped[list[SourceFile]] = relationship(back_populates="snapshot", passive_deletes=True)
    file_tree_nodes: Mapped[list[FileTreeNode]] = relationship(back_populates="snapshot", passive_deletes=True)

    __table_args__ = (CheckConstraint("finding_count >= 0", name="finding_count_nonnegative"),)
