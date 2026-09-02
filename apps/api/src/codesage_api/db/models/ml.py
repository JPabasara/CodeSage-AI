from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Double,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import MLModelType, ModelDeploymentStatus

if TYPE_CHECKING:
    from codesage_api.db.models.finding import DebtCategory, Finding
    from codesage_api.db.models.provenance import AnalysisEngineModelVersion
    from codesage_api.db.models.source import SourceFile, SourceLocation


def values(enum: type[MLModelType | ModelDeploymentStatus]) -> list[str]:
    return [item.value for item in enum]


class MLModelVersion(UUIDPrimaryKey, Base):
    __tablename__ = "ml_model_version"
    model_type: Mapped[MLModelType] = mapped_column(Enum(MLModelType, name="ml_model_type", values_callable=values))
    version_identifier: Mapped[str] = mapped_column(String(100))
    training_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deployment_status: Mapped[ModelDeploymentStatus] = mapped_column(Enum(ModelDeploymentStatus, name="model_deployment_status", values_callable=values))
    evaluation_dataset_reference: Mapped[str] = mapped_column(String(1000))
    evaluation_metrics: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSONB))
    satd_predictions: Mapped[list[SATDPrediction]] = relationship(back_populates="model_version")
    bug_risk_predictions: Mapped[list[BugRiskPrediction]] = relationship(back_populates="model_version")
    engine_version_links: Mapped[list[AnalysisEngineModelVersion]] = relationship(back_populates="model_version")
    __table_args__ = (UniqueConstraint("model_type", "version_identifier"),)


class SATDPrediction(UUIDPrimaryKey, Base):
    __tablename__ = "satd_prediction"
    source_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_location.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("debt_category.category_id", ondelete="RESTRICT"), index=True)
    model_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ml_model_version.id", ondelete="RESTRICT"), index=True)
    is_debt: Mapped[bool] = mapped_column(Boolean)
    confidence: Mapped[float] = mapped_column(Double)
    explanation: Mapped[str] = mapped_column(Text)
    source_location: Mapped[SourceLocation] = relationship(back_populates="satd_predictions")
    category: Mapped[DebtCategory | None] = relationship(back_populates="satd_predictions")
    model_version: Mapped[MLModelVersion] = relationship(back_populates="satd_predictions")
    finding: Mapped[Finding | None] = relationship(back_populates="satd_prediction", uselist=False)
    __table_args__ = (
        CheckConstraint("(is_debt AND category_id IS NOT NULL) OR (NOT is_debt AND category_id IS NULL)", name="debt_category_consistency"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_probability"),
    )


class BugRiskPrediction(UUIDPrimaryKey, Base):
    __tablename__ = "bug_risk_prediction"
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.id", ondelete="CASCADE"), index=True)
    model_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ml_model_version.id", ondelete="RESTRICT"), index=True)
    risk_score: Mapped[float] = mapped_column(Double)
    confidence: Mapped[float | None] = mapped_column(Double, nullable=True)
    source_file: Mapped[SourceFile] = relationship(back_populates="bug_risk_predictions")
    model_version: Mapped[MLModelVersion] = relationship(back_populates="bug_risk_predictions")
    __table_args__ = (
        UniqueConstraint("source_file_id", "model_version_id"),
        CheckConstraint("risk_score >= 0 AND risk_score <= 1", name="risk_score_probability"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_probability"),
    )
