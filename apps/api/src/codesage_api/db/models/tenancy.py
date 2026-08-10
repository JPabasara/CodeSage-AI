"""Tenant and access data (SAD §9 group 1): WORKSPACE, USER, MEMBERSHIP,
SECURITY_AUDIT_RECORD.

The workspace is the tenant boundary. Every tenant-owned table carries
`workspace_id` and is protected by Row-Level Security (SRS DBR-3). The column
exists from day one even though v1.0 limits a workspace to one active member
(DBR-4), so multi-user workspaces in v2 are not a migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base, TimestampMixin, UUIDPrimaryKey


class Workspace(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "workspace"

    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # The active profile hangs off WORKSPACE, not off a session and not as an
    # `is_active` flag on SCORING_PROFILE. That makes "exactly one active profile
    # per workspace" a STRUCTURAL guarantee rather than a constraint someone has to
    # remember to enforce, and it means the read path resolves the profile through
    # a join it is already making for RLS (SRS FR-20, FR-21).
    active_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scoring_profile.id", ondelete="SET NULL"), nullable=True
    )


class User(UUIDPrimaryKey, TimestampMixin, Base):
    """An authenticated user. Identity is kept separate from workspace membership,
    so a user can belong to several workspaces in v2 without duplication."""

    __tablename__ = "app_user"  # "user" is reserved in PostgreSQL

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    github_login: Mapped[str | None] = mapped_column(String(200), nullable=True)
    github_user_id: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)

    # NOTE: no OAuth token column. SRS PRI-02 keeps GitHub credentials inside the
    # backend service and SEC-08 keeps them in environment/secret storage; v1.0
    # clones public repositories anonymously, so no per-user token is persisted.


class Membership(UUIDPrimaryKey, TimestampMixin, Base):
    """Joins a user to a workspace.

    `role` exists from day one but governs nothing in v1.0 — there is no RBAC
    (SRS FR-23 is v2, DBR-5 defers role/permission tables). It is here because the
    tenant seam has to be in the right place before v2 can add roles.
    """

    __tablename__ = "membership"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="developer")


class SecurityAuditRecord(UUIDPrimaryKey, Base):
    """A security-relevant system event (SAD §5.2 Security Auditing package).

    Stores event type, timestamp, actor, affected resource and outcome — and
    explicitly never an authentication secret. Sign-ins, sign-outs, repository
    connections and failed authorisations land here so there is an auditable
    history that does not depend on log retention.
    """

    __tablename__ = "security_audit_record"

    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Nullable: a failed sign-in has no established actor yet, and that is exactly
    # the event most worth recording.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)  # success | failure | denied
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
