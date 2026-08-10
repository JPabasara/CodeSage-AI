"""Analysis-engine provenance (SAD §9 group 4; SRS DBR-8, DBR-18, REL-10).

ANALYSIS_ENGINE_VERSION and its join to the model registry.

Why this exists at all: REL-10 promises that the same repository revision analysed
twice produces consistent results. That promise is only checkable if the system
records *what analysed it* — CK's version, the rule-set version, the extraction
logic and the model versions. Without this table, "the results changed" and "the
engine changed" are indistinguishable after the fact.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, TimestampMixin, UUIDPrimaryKey


class AnalysisEngineVersion(UUIDPrimaryKey, TimestampMixin, Base):
    """One frozen configuration of the analysis pipeline (DBR-8).

    Every AnalysisAttempt points at the row that describes the engine that ran it.
    Bump `version` whenever any component below changes; the old row stays, so
    historical attempts keep describing themselves truthfully.
    """

    __tablename__ = "analysis_engine_version"

    version: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)

    # The static-analysis toolchain. v1.0: CK for Java metrics, Tree-sitter for
    # comment extraction, PyDriller for history (FR-7).
    ck_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tree_sitter_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pydriller_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # The rule register (Appendix C.1) and marker table (C.2) in force.
    rule_set_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    extraction_logic_version: Mapped[str | None] = mapped_column(String(50), nullable=True)


class AnalysisEngineModelVersion(UUIDPrimaryKey, Base):
    """Join: which model versions belonged to an engine version.

    Many-to-many rather than two nullable columns on AnalysisEngineVersion, because
    an engine bundles one SATD model and one risk model today but the count is not
    a property the schema should hard-code.
    """

    __tablename__ = "analysis_engine_model_version"

    engine_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_engine_version.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ml_model_version.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    __table_args__ = (
        UniqueConstraint("engine_version_id", "model_version_id", name="uq_engine_model"),
    )
