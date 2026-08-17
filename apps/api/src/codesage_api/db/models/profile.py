from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Double, Enum, ForeignKey, Index, String, UniqueConstraint, func, text
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
    security_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    documentation_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)


class ScoringProfile(UUIDPrimaryKey, Base):
    __tablename__ = "scoring_profile"
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    security_weight: Mapped[float] = mapped_column(Double)
    code_design_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    documentation_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    modified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspace: Mapped[Workspace] = relationship(back_populates="scoring_profiles")
    # Applying a profile UPDATEs this row in place; it is never versioned and no
    # history is kept. Nothing in docs/api/openapi.yaml can express or return a
    # version, so a row per Apply would grow unbounded for a history no endpoint
    # could read — and since scores are derived on read (FR-21), a superseded
    # profile explains no stored result either.
    __table_args__ = (
        UniqueConstraint("workspace_id", "name"),
        # "At most one active profile per workspace", refused by the database on
        # write rather than remembered by a handler (locked decision 11). *At
        # least* one is a separate guarantee, held by sign-in seeding Balanced as
        # active — so apply_profile must clear the old row and set the new one in
        # one transaction.
        Index("uq_scoring_profile_one_active", "workspace_id", unique=True, postgresql_where=text("is_active")),
    )
