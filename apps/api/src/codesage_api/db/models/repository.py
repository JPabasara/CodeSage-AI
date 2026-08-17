from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import RepositoryConnectionStatus, RepositoryPlatform, RepositoryVisibility

if TYPE_CHECKING:
    from codesage_api.db.models.analysis import AnalysisAttempt
    from codesage_api.db.models.tenancy import Workspace


def values(enum: type[RepositoryPlatform] | type[RepositoryVisibility] | type[RepositoryConnectionStatus]) -> list[str]:
    return [item.value for item in enum]


class Repository(UUIDPrimaryKey, Base):
    __tablename__ = "repository"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    source_platform: Mapped[RepositoryPlatform] = mapped_column(Enum(RepositoryPlatform, name="repository_platform", values_callable=values))
    external_repository_id: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    visibility: Mapped[RepositoryVisibility] = mapped_column(Enum(RepositoryVisibility, name="repository_visibility", values_callable=values))
    connection_status: Mapped[RepositoryConnectionStatus] = mapped_column(Enum(RepositoryConnectionStatus, name="repository_connection_status", values_callable=values))
    workspace: Mapped[Workspace] = relationship(back_populates="repositories")
    branches: Mapped[list[Branch]] = relationship(back_populates="repository", passive_deletes=True)

    __table_args__ = (UniqueConstraint("workspace_id", "source_platform", "external_repository_id"),)


class Branch(UUIDPrimaryKey, Base):
    __tablename__ = "branch"

    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repository.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    head_commit_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    repository: Mapped[Repository] = relationship(back_populates="branches")
    analysis_attempts: Mapped[list[AnalysisAttempt]] = relationship(back_populates="branch", passive_deletes=True)

    __table_args__ = (
        UniqueConstraint("repository_id", "name"),
        Index("uq_branch_one_default", "repository_id", unique=True, postgresql_where=text("is_default")),
    )
