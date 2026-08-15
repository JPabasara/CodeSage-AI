from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Double, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import Severity

if TYPE_CHECKING:
    from codesage_api.db.models.finding import DebtCategory, Finding


def values(enum: type[Severity]) -> list[str]:
    return [item.value for item in enum]


class RuleDefinition(Base):
    __tablename__ = "rule_definition"
    rule_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("debt_category.category_id", ondelete="RESTRICT"), index=True)
    threshold: Mapped[float] = mapped_column(Double)
    severity: Mapped[Severity] = mapped_column(Enum(Severity, name="severity", values_callable=values))
    message_template: Mapped[str] = mapped_column(Text)
    category: Mapped[DebtCategory] = relationship(back_populates="rule_definitions")
    findings: Mapped[list[Finding]] = relationship(back_populates="rule_definition")


class SATDMarkerPattern(UUIDPrimaryKey, Base):
    __tablename__ = "satd_marker_pattern"
    pattern: Mapped[str] = mapped_column(Text)
    severity: Mapped[Severity] = mapped_column(Enum(Severity, name="severity", values_callable=values))
    message_template: Mapped[str] = mapped_column(Text)
