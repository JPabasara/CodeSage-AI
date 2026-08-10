"""Machine-learning outputs and the model registry (SAD §9 groups 3–4).

SATD_PREDICTION, BUG_RISK_PREDICTION, ML_MODEL_VERSION.
Covers SRS DBR-16 (prediction results) and DBR-17 (model registry).

The two models are independent and are never chained: they take different inputs,
produce different outputs and exchange no data (SAD §6 decision 10).
"""

from __future__ import annotations

import uuid
from datetime import datetime 
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, UUIDPrimaryKey


class MLModelVersion(UUIDPrimaryKey, Base):
    """Registry of ML model versions used by the system."""

    __tablename__ = "ml_model_version"

    model_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )

    version_identifier: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    training_date: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    deployment_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )

    evaluation_dataset_reference: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    evaluation_metrics: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "model_type",
            "version_identifier",
            name="uq_ml_model_type_version",
        ),
    )

class SATDPrediction(UUIDPrimaryKey, Base):
    """ML-1's output for one comment (DBR-16).

    The model predicts a CATEGORY and a debt/not-debt decision — never a severity.
    A supervised model can only predict what its training data labels, and SATDAUG
    labels categories, so severity comes from the deterministic marker table
    instead (FR-9.2).

    Stored separately from FINDING because not every prediction becomes a finding:
    a comment classified `non_debt` produces a prediction and no finding at all.
    Keeping both lets the ML evaluation in FR-25 be run against real traffic.
    """

    __tablename__ = "satd_prediction"

    finding_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("finding.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ml_model_version.id", ondelete="RESTRICT"), nullable=False
    )

    is_debt: Mapped[bool] = mapped_column(Boolean, nullable=False)
    predicted_category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("debt_category.id", ondelete="RESTRICT"), nullable=True
    )
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)


class BugRiskPrediction(UUIDPrimaryKey, Base):
    """ML-2's output for one file (FR-10, DBR-16).

    Produces a score, not a finding. Its only two effects are the bounded
    `risk_factor` multiplier on the priorities of findings already in that file,
    and the per-file risk badge. A risky file with no findings contributes no debt.

    Duplicated onto SourceFile.risk_score for the read path: this table is the
    provenance record (which model version, what confidence), while the column is
    what the scoring query reads without a join on every dashboard load.
    """

    __tablename__ = "bug_risk_prediction"

    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ml_model_version.id", ondelete="RESTRICT"), nullable=False
    )
    risk_score: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
