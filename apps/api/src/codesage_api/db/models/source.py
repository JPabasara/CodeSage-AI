"""Analysed source structure and extracted metrics (SAD §9 group 2).

SOURCE_FILE, FILE_TREE_NODE, CODE_SYMBOL, SOURCE_LOCATION, STATIC_METRIC,
PROCESS_METRIC. Covers SRS DBR-11 (component metadata), DBR-12 (extracted
metrics), DBR-14 (finding locations) and DBR-20 (commit/churn data).

⚠️ DBR-27: the database never stores source-code files, whole file contents or
arbitrary snippets. These tables hold *metadata about* code — paths, symbol names,
line ranges, measurements — never the code itself. The snippet shown in the
finding-detail view is fetched on demand from the stored revision and location.
The single exception is the SATD comment text, held as evidence on the finding
that it produced, and only that comment.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, UUIDPrimaryKey


class SourceFile(UUIDPrimaryKey, Base):
    """One analysed file in one snapshot.

    v1.0 analyses Java sources only, because CK is a Java-only extractor (SRS
    §2.4). `language` is stored anyway so that adding a second language is a rule
    pack plus a recalibration rather than a schema change (SP/MAINT-03).
    """

    __tablename__ = "source_file"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    language: Mapped[str] = mapped_column(String(50), nullable=False, default="java")
    loc: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ML-2's per-file output (FR-10). A stored fact for fixed inputs. NOT a debt
    # score — debt is derived. 0.0 when the ML service was unreachable, which makes
    # risk_factor fall back to 1.0 and boost nothing.
    risk_score: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("snapshot_id", "path", name="uq_source_file_snapshot_path"),
    )


class FileTreeNode(UUIDPrimaryKey, Base):
    """The repository tree as analysed, so the hotspot heat map can be rebuilt.

    Stored rather than recomputed because FR-18 lets the user expand, collapse and
    drill into folders, and folder health is an aggregation of the stored file
    scores beneath it. Aggregation happens on read, so no score is stored here.
    """

    __tablename__ = "file_tree_node"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("file_tree_node.id", ondelete="CASCADE"), nullable=True
    )
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    node_type: Mapped[str] = mapped_column(String(10), nullable=False)  # file | folder
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("snapshot_id", "path", name="uq_tree_node_snapshot_path"),
    )


class CodeSymbol(UUIDPrimaryKey, Base):
    """A class, method or function inside an analysed file (DBR-11).

    This is what a finding points at when it is not file-level, and what the
    reason templates interpolate as `{symbol}`.
    """

    __tablename__ = "code_symbol"

    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    symbol_type: Mapped[str] = mapped_column(String(30), nullable=False)  # class | method | field
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)


class SourceLocation(UUIDPrimaryKey, Base):
    """Where a finding is, precisely (DBR-14).

    Start/end line and column, or a component-level reference when the finding
    applies to a whole file, class or method. Separated from FINDING because a
    location is also what the on-demand snippet fetch needs, and because a
    file-level finding legitimately has no line.
    """

    __tablename__ = "source_location"

    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_symbol_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("code_symbol.id", ondelete="SET NULL"), nullable=True
    )
    start_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_column: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_column: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # file | class | method — set when the finding is component-level, not line-level.
    component_scope: Mapped[str | None] = mapped_column(String(20), nullable=True)


class StaticMetric(UUIDPrimaryKey, Base):
    """A CK measurement for one file or symbol (DBR-12).

    Key/value rather than a column per metric: CK emits dozens (WMC, CBO, DIT,
    LCOM, RFC, NOC, LOC, nesting…), the rule engine only thresholds a handful, and
    ML-2 consumes a feature vector whose composition will change when the model is
    retrained. A wide table would need a migration every time either changed.

    `metric_name` values come from CK's own vocabulary so training and inference
    read the same names.
    """

    __tablename__ = "static_metric"

    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_symbol_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("code_symbol.id", ondelete="CASCADE"), nullable=True, index=True
    )
    metric_name: Mapped[str] = mapped_column(String(50), nullable=False)
    metric_value: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    __table_args__ = (
        Index("ix_static_metric_file_name", "source_file_id", "metric_name"),
    )


class ProcessMetric(UUIDPrimaryKey, Base):
    """The four PyDriller history metrics for one file (FR-7, DBR-20).

    Git history enters the pipeline as numbers, never as text (FR-7.1). These four
    numbers are that boundary: churn, author count, file age and recency. Commit
    message text is not here and is not a detection input, because it has no
    file:line for a finding to point at.

    `commits_90d` is the raw count FR-21 requires to be stored — the churn *factor*
    derived from it is not stored, because it is an input to scoring. The window is
    anchored to the scanned commit's committer date, held on AnalysisAttempt.
    """

    __tablename__ = "process_metric"

    source_file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_file.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    commits_90d: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lines_changed_90d: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    author_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_age_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recency_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
