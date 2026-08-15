from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Double, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import ScoringPresetType

if TYPE_CHECKING:
    from codesage_api.db.models.tenancy import Workspace


def values(enum: type[ScoringPresetType]) -> list[str]:
    return [item.value for item in enum]


class ScoringPreset(Base):
    __tablename__ = "scoring_preset"
    preset_type: Mapped[ScoringPresetType] = mapped_column(Enum(ScoringPresetType, name="scoring_preset_type", values_callable=values), primary_key=True)
    code_design_weight: Mapped[float] = mapped_column(Double)
    defect_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    documentation_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)


class ScoringProfile(UUIDPrimaryKey, Base):
    __tablename__ = "scoring_profile"
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    security_weight: Mapped[float] = mapped_column(Double)
    code_design_weight: Mapped[float] = mapped_column(Double)
    defect_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    document_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    modified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspace: Mapped[Workspace] = relationship(back_populates="scoring_profiles")
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", "version"),
        Index("uq_scoring_profile_one_active", "workspace_id", unique=True, postgresql_where=text("is_active")),
    )
