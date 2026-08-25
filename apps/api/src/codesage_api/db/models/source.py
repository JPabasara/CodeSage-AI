from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Double,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import CodeSymbolType, FileTreeNodeType

if TYPE_CHECKING:
    from codesage_api.db.models.analysis import Snapshot
    from codesage_api.db.models.finding import Finding
    from codesage_api.db.models.ml import BugRiskPrediction, SATDPrediction


def values(enum: type[CodeSymbolType | FileTreeNodeType]) -> list[str]:
    return [item.value for item in enum]


class SourceFile(UUIDPrimaryKey, Base):
    __tablename__ = "source_file"
    snapshot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("snapshot.id", ondelete="CASCADE"), index=True)
    relative_path: Mapped[str] = mapped_column(String(1000))
    language: Mapped[str] = mapped_column(String(100))
    snapshot: Mapped[Snapshot] = relationship(back_populates="source_files")
    code_symbols: Mapped[list[CodeSymbol]] = relationship(back_populates="source_file", passive_deletes=True)
    source_locations: Mapped[list[SourceLocation]] = relationship(back_populates="source_file", passive_deletes=True)
    static_metrics: Mapped[list[StaticMetric]] = relationship(back_populates="source_file", passive_deletes=True)
    process_metric: Mapped[ProcessMetric | None] = relationship(back_populates="source_file", uselist=False, passive_deletes=True)
    bug_risk_predictions: Mapped[list[BugRiskPrediction]] = relationship(back_populates="source_file", passive_deletes=True)
    file_tree_nodes: Mapped[list[FileTreeNode]] = relationship(back_populates="source_file")
    __table_args__ = (UniqueConstraint("snapshot_id", "relative_path"),)


class CodeSymbol(UUIDPrimaryKey, Base):
    __tablename__ = "code_symbol"
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(500))
    symbol_type: Mapped[CodeSymbolType] = mapped_column(Enum(CodeSymbolType, name="code_symbol_type", values_callable=values))
    source_file: Mapped[SourceFile] = relationship(back_populates="code_symbols")
    source_locations: Mapped[list[SourceLocation]] = relationship(back_populates="code_symbol")
    static_metrics: Mapped[list[StaticMetric]] = relationship(back_populates="code_symbol")


class SourceLocation(UUIDPrimaryKey, Base):
    __tablename__ = "source_location"
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.id", ondelete="CASCADE"), index=True)
    code_symbol_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("code_symbol.id", ondelete="SET NULL"), index=True)
    start_line: Mapped[int] = mapped_column(Integer)
    end_line: Mapped[int] = mapped_column(Integer)
    start_column: Mapped[int] = mapped_column(Integer)
    end_column: Mapped[int] = mapped_column(Integer)
    source_file: Mapped[SourceFile] = relationship(back_populates="source_locations")
    code_symbol: Mapped[CodeSymbol | None] = relationship(back_populates="source_locations")
    findings: Mapped[list[Finding]] = relationship(back_populates="source_location", passive_deletes=True)
    satd_predictions: Mapped[list[SATDPrediction]] = relationship(back_populates="source_location", passive_deletes=True)
    __table_args__ = (
        CheckConstraint("start_line >= 1 AND end_line >= 1 AND start_line <= end_line", name="valid_lines"),
        CheckConstraint("start_column >= 0 AND end_column >= 0", name="nonnegative_columns"),
    )


class StaticMetric(UUIDPrimaryKey, Base):
    __tablename__ = "static_metric"
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.id", ondelete="CASCADE"), index=True)
    code_symbol_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("code_symbol.id", ondelete="CASCADE"), index=True)
    metric_name: Mapped[str] = mapped_column(String(100), index=True)
    value: Mapped[float] = mapped_column(Double)
    source_file: Mapped[SourceFile] = relationship(back_populates="static_metrics")
    code_symbol: Mapped[CodeSymbol | None] = relationship(back_populates="static_metrics")


class ProcessMetric(UUIDPrimaryKey, Base):
    __tablename__ = "process_metric"
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.id", ondelete="CASCADE"), unique=True)
    commits_90d: Mapped[int] = mapped_column(Integer)
    author_count: Mapped[int] = mapped_column(Integer)
    file_age: Mapped[float] = mapped_column(Double)
    recency: Mapped[float] = mapped_column(Double)
    source_file: Mapped[SourceFile] = relationship(back_populates="process_metric")
    __table_args__ = (CheckConstraint("author_count >= 0", name="author_count_nonnegative"),)


class FileTreeNode(UUIDPrimaryKey, Base):
    __tablename__ = "file_tree_node"
    snapshot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("snapshot.id", ondelete="CASCADE"), index=True)
    parent_node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("file_tree_node.id", ondelete="CASCADE"), index=True)
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("source_file.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    node_type: Mapped[FileTreeNodeType] = mapped_column(Enum(FileTreeNodeType, name="file_tree_node_type", values_callable=values))
    snapshot: Mapped[Snapshot] = relationship(back_populates="file_tree_nodes")
    parent: Mapped[FileTreeNode | None] = relationship(back_populates="children", remote_side="FileTreeNode.id")
    children: Mapped[list[FileTreeNode]] = relationship(back_populates="parent", passive_deletes=True)
    source_file: Mapped[SourceFile | None] = relationship(back_populates="file_tree_nodes")
    __table_args__ = (CheckConstraint("(node_type = 'file' AND source_file_id IS NOT NULL) OR (node_type = 'folder' AND source_file_id IS NULL)", name="node_source_file"),)
