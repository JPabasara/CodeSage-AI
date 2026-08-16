from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import MembershipStatus, Theme

if TYPE_CHECKING:
    from codesage_api.db.models.profile import ScoringProfile
    from codesage_api.db.models.repository import Repository


def enum_values(enum: type[Theme] | type[MembershipStatus]) -> list[str]:
    return [item.value for item in enum]


class User(UUIDPrimaryKey, Base):
    __tablename__ = "app_user"

    # Who this person is. Permanent and unique. Set once at first sign-in and
    # never changed — this is the only column anything is allowed to key on.
    asgardeo_sub: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )

    # Everything below is for showing on screen. None of it is identity.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # "github", "google", "local" — which button they clicked inside Asgardeo.
    identity_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Kept for display only. Now nullable, and no longer unique: someone who
    # signs in with Google has no GitHub account at all.
    github_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    github_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    theme_preference: Mapped[Theme] = mapped_column(
        Enum(Theme, name="theme", values_callable=enum_values),
        nullable=False,
        default=Theme.SYSTEM,
    )
    memberships: Mapped[list[Membership]] = relationship(
        back_populates="user", passive_deletes=True
    )



class Workspace(UUIDPrimaryKey, Base):
    __tablename__ = "workspace"

    memberships: Mapped[list[Membership]] = relationship(back_populates="workspace", passive_deletes=True)
    repositories: Mapped[list[Repository]] = relationship(back_populates="workspace", passive_deletes=True)
    scoring_profiles: Mapped[list[ScoringProfile]] = relationship(back_populates="workspace", passive_deletes=True)
    security_audit_records: Mapped[list[SecurityAuditRecord]] = relationship(
        back_populates="workspace", passive_deletes=True
    )


class Membership(UUIDPrimaryKey, Base):
    __tablename__ = "membership"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    status: Mapped[MembershipStatus] = mapped_column(
        Enum(MembershipStatus, name="membership_status", values_callable=enum_values), nullable=False
    )
    user: Mapped[User] = relationship(back_populates="memberships")
    workspace: Mapped[Workspace] = relationship(back_populates="memberships")

    __table_args__ = (UniqueConstraint("user_id", "workspace_id"),)


class SecurityAuditRecord(UUIDPrimaryKey, Base):
    __tablename__ = "security_audit_record"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="RESTRICT"), index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_identity: Mapped[str] = mapped_column(String(255), nullable=False)
    affected_resource: Mapped[str] = mapped_column(String(500), nullable=False)
    workspace: Mapped[Workspace] = relationship(back_populates="security_audit_records")

    __table_args__ = (Index("ix_security_audit_record_workspace_timestamp", "workspace_id", "timestamp"),)


class UserSession(UUIDPrimaryKey, Base):
    """One signed-in browser.

    The cookie we give the browser holds this row's id and nothing else — a
    random number that means nothing on its own. Everything that matters lives
    here, on the server. That is what makes signing out actually work: we delete
    this row, and the next request finds nothing and gets a 401.
    """

    __tablename__ = "session"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Bumped on every request, so an active user is never signed out mid-work.
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
