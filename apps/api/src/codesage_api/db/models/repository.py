"""REPOSITORY and BRANCH (SAD §9 group 2; SRS DBR-9, DBR-20)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, TimestampMixin, UUIDPrimaryKey


class Repository(UUIDPrimaryKey, TimestampMixin, Base):
    """A connected repository. v1.0 connects PUBLIC repositories by pasted URL only.

    There is no GitHub App installation and no private-repository support in v1.0
    (SRS FR-3, SEC-04, SAD §1.2). `visibility` is stored anyway because the connect
    handler reads it from the GitHub REST API in order to reject anything that is
    not public — recording what was checked is cheaper than re-checking.

    `source_platform` and `external_repo_id` are stored per DBR-9 so that adding a
    second Git host later does not require a schema change.
    """

    __tablename__ = "repository"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_platform: Mapped[str] = mapped_column(String(50), nullable=False, default="github")
    external_repo_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    owner: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="public")
    default_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    connection_status: Mapped[str] = mapped_column(String(30), nullable=False, default="connected")
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (UniqueConstraint("workspace_id", "url", name="uq_repository_workspace_url"),)


class Branch(UUIDPrimaryKey, TimestampMixin, Base):
    """A branch and the head revision last seen on it (SRS FR-5, DBR-10).

    Analysis is per branch: each branch has its own snapshots and its own trend.

    `head_commit_sha` feeds the equivalent-analysis comparison. Note what it is
    compared against: the SHA of the most recent SUCCESSFULLY COMPLETED analysis,
    never simply the most recent one. A cancelled or failed attempt leaves an
    AnalysisAttempt row with no Snapshot, and comparing against that would make the
    system skip the work and then serve a snapshot that was never written
    (SAD §6 decision 3, DBR-10, DBR-22).
    """

    __tablename__ = "branch"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repository.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    head_commit_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    head_commit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("repository_id", "name", name="uq_branch_repository_name"),)
