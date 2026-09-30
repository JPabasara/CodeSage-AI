from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import FindingSource, Severity

if TYPE_CHECKING:
    from codesage_api.db.models.ml import SATDPrediction
    from codesage_api.db.models.rules import RuleDefinition
    from codesage_api.db.models.source import SourceLocation


def values(enum: type[FindingSource] | type[Severity]) -> list[str]:
    return [item.value for item in enum]


class DebtCategory(Base):
    __tablename__ = "debt_category"
    category_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(100))
    findings: Mapped[list[Finding]] = relationship(back_populates="category")
    rule_definitions: Mapped[list[RuleDefinition]] = relationship(back_populates="category")
    satd_predictions: Mapped[list[SATDPrediction]] = relationship(back_populates="category")


class Finding(UUIDPrimaryKey, Base):
    __tablename__ = "finding"
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"), index=True
    )
    source_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_location.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("debt_category.category_id", ondelete="RESTRICT"), index=True)
    rule_id: Mapped[str | None] = mapped_column(ForeignKey("rule_definition.rule_id", ondelete="SET NULL"), index=True)
    satd_prediction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("satd_prediction.id", ondelete="SET NULL"), unique=True, index=True)
    source: Mapped[FindingSource] = mapped_column(Enum(FindingSource, name="finding_source", values_callable=values))
    severity: Mapped[Severity] = mapped_column(Enum(Severity, name="severity", values_callable=values), index=True)
    description: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    measured_value: Mapped[float | None] = mapped_column(Double)
    threshold: Mapped[float | None] = mapped_column(Double)
    confidence: Mapped[float | None] = mapped_column(Double)
    fingerprint: Mapped[str] = mapped_column(String(128), index=True)
    class_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    method_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_location: Mapped[SourceLocation] = relationship(back_populates="findings")
    category: Mapped[DebtCategory] = relationship(back_populates="findings")
    rule_definition: Mapped[RuleDefinition | None] = relationship(back_populates="findings")
    satd_prediction: Mapped[SATDPrediction | None] = relationship(back_populates="finding")
    __table_args__ = (
        UniqueConstraint("snapshot_id", "fingerprint", name="uq_finding_snapshot_fingerprint"),
        CheckConstraint("(source = 'rule' AND rule_id IS NOT NULL AND satd_prediction_id IS NULL) OR (source = 'satd' AND satd_prediction_id IS NOT NULL AND rule_id IS NULL)", name="provenance_consistency"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_probability"),
    )


class FindingTriage(Base):
    """Collaboration status of one finding in one snapshot.

    Kept apart from `finding` because result tables are immutable: triage is a
    workflow label layered over the stored facts, never an input to scoring.
    The composite key follows the finding's own identity, so the label belongs
    to exactly one snapshot and a rescan starts every finding open again.
    """

    __tablename__ = "finding_triage"
    snapshot_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(20))
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    __table_args__ = (
        ForeignKeyConstraint(
            ["snapshot_id", "fingerprint"],
            ["finding.snapshot_id", "finding.fingerprint"],
            ondelete="CASCADE",
            name="fk_finding_triage_finding",
        ),
        CheckConstraint("status IN ('open', 'done')", name="status_value"),
    )
