"""FINDING and DEBT_CATEGORY (SAD §9 group 3; SRS DBR-13, DBR-14, DBR-15)."""

from __future__ import annotations
import uuid
from sqlalchemy import ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from codesage_api.db.base import Base, UUIDPrimaryKey


class DebtCategory(Base):
    """Reference data for the supported technical debt categories."""

    __tablename__ = "debt_category"

    category_id: Mapped[str] = mapped_column(
        String(30),
        primary_key=True
    )

    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )


class Finding(UUIDPrimaryKey, Base):
    """One detected technical-debt finding."""

    __tablename__ = "finding"

    source_location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    category_id: Mapped[str] = mapped_column(
        ForeignKey("debt_category.category_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    rule_id: Mapped[str | None] = mapped_column(
        ForeignKey("rule_definition.rule_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    satd_prediction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("satd_prediction.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    evidence: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    measured_value: Mapped[float | None] = mapped_column(
        Numeric(14, 4),
        nullable=True,
    )

    threshold: Mapped[float | None] = mapped_column(
        Numeric(14, 4),
        nullable=True,
    )

    confidence: Mapped[float | None] = mapped_column(
        Numeric(5, 4),
        nullable=True,
    )

    fingerprint: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        index=True,
    )