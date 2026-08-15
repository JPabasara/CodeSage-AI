from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey

if TYPE_CHECKING:
    from codesage_api.db.models.analysis import AnalysisAttempt
    from codesage_api.db.models.ml import MLModelVersion


class AnalysisEngineVersion(UUIDPrimaryKey, Base):
    __tablename__ = "analysis_engine_version"

    version_identifier: Mapped[str] = mapped_column(String(100), unique=True)
    tool_versions: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSONB))
    rule_set_version: Mapped[str] = mapped_column(String(100))
    extraction_logic_version: Mapped[str] = mapped_column(String(100))
    analysis_attempts: Mapped[list[AnalysisAttempt]] = relationship(back_populates="analysis_engine_version")
    model_version_links: Mapped[list[AnalysisEngineModelVersion]] = relationship(
        back_populates="analysis_engine_version", passive_deletes=True
    )


class AnalysisEngineModelVersion(Base):
    __tablename__ = "analysis_engine_model_version"

    analysis_engine_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_engine_version.id", ondelete="CASCADE"), primary_key=True
    )
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ml_model_version.id", ondelete="RESTRICT"), primary_key=True
    )
    analysis_engine_version: Mapped[AnalysisEngineVersion] = relationship(back_populates="model_version_links")
    model_version: Mapped[MLModelVersion] = relationship(back_populates="engine_version_links")
