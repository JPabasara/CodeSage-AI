from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from codesage_api.db.base import Base, UUIDPrimaryKey
from codesage_api.db.enums import ScoringPresetType, ScoringProfileKind

if TYPE_CHECKING:
    from codesage_api.db.models.repository import Repository
    from codesage_api.db.models.tenancy import Workspace


def values(enum: type[ScoringPresetType | ScoringProfileKind]) -> list[str]:
    return [item.value for item in enum]


# One type object shared by both columns that store a preset key, so the
# PostgreSQL enum is emitted once per metadata rather than once per column.
PRESET_TYPE = Enum(ScoringPresetType, name="scoring_preset_type", values_callable=values)
PROFILE_KIND = Enum(ScoringProfileKind, name="scoring_profile_kind", values_callable=values)


class ScoringPreset(Base):
    __tablename__ = "scoring_preset"
    preset_type: Mapped[ScoringPresetType] = mapped_column(PRESET_TYPE, primary_key=True)
    code_design_weight: Mapped[float] = mapped_column(Double)
    security_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    documentation_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)


class ScoringProfile(UUIDPrimaryKey, Base):
    """One profile in a workspace's reusable pool.

    Every workspace holds exactly three built-ins (Balanced, Security-first,
    Delivery-speed) plus up to five custom profiles. Which profile a workspace
    scores with is NOT a column here — that pointer lives in
    WorkspaceProfileSettings, so the pool has one row per profile and exactly one
    place says which of them is in force.
    """

    __tablename__ = "scoring_profile"
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    kind: Mapped[ScoringProfileKind] = mapped_column(
        PROFILE_KIND, nullable=False, server_default=ScoringProfileKind.CUSTOM.value
    )
    # Set on built-ins only, and it is what makes "the Balanced of this
    # workspace" addressable without matching on a display name.
    preset_key: Mapped[ScoringPresetType | None] = mapped_column(PRESET_TYPE, nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    security_weight: Mapped[float] = mapped_column(Double)
    code_design_weight: Mapped[float] = mapped_column(Double)
    requirement_weight: Mapped[float] = mapped_column(Double)
    documentation_weight: Mapped[float] = mapped_column(Double)
    test_weight: Mapped[float] = mapped_column(Double)
    trust_slider: Mapped[float] = mapped_column(Double)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    modified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspace: Mapped[Workspace] = relationship(back_populates="scoring_profiles")

    __table_args__ = (
        # The target of every composite foreign key below. Carrying workspace_id
        # into the referring key is what makes a cross-workspace reference
        # unrepresentable rather than merely rejected by a service check.
        UniqueConstraint("workspace_id", "id"),
        # At most one built-in per preset per workspace. NULLs compare as
        # distinct in PostgreSQL, so custom rows are untouched by this.
        UniqueConstraint("workspace_id", "preset_key"),
        CheckConstraint(
            "(kind = 'built_in' AND preset_key IS NOT NULL) "
            "OR (kind = 'custom' AND preset_key IS NULL)",
            name="kind_preset_key",
        ),
        # Names are compared case- and whitespace-insensitively, and across the
        # whole pool rather than only among custom rows: a custom named
        # "balanced " would be indistinguishable from the built-in in every
        # selector the web draws.
        Index(
            "uq_scoring_profile_workspace_name_normalized",
            text("workspace_id"),
            text("lower(btrim(name))"),
            unique=True,
        ),
    )


class WorkspaceProfileSettings(Base):
    """The one profile a workspace scores with unless a project overrides it.

    One row per workspace, so "exactly one default" is the shape of the table
    rather than a rule someone has to remember. The composite foreign key keeps
    that default inside the same workspace, and its NO ACTION rule is what
    refuses to delete a profile while it is still the default.
    """

    __tablename__ = "workspace_profile_settings"

    # workspace_id is the primary key, so "exactly one default per workspace"
    # is a shape the database cannot represent wrongly.
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), primary_key=True
    )
    default_scoring_profile_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    workspace: Mapped[Workspace] = relationship(back_populates="profile_settings")

    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "default_scoring_profile_id"],
            ["scoring_profile.workspace_id", "scoring_profile.id"],
            # NO ACTION, not RESTRICT. Both refuse to orphan the pointer, but
            # RESTRICT is checked the instant the profile row goes, which would
            # abort a workspace deletion whose own cascade is about to remove
            # this row anyway. NO ACTION is checked once the statement has
            # finished cascading, so the workspace delete succeeds while an
            # ordinary "delete a profile that is still the default" still fails.
            ondelete="NO ACTION",
            name="fk_workspace_profile_settings_default_scoring_profile",
        ),
    )


class RepositoryProfileAssignment(Base):
    """One project's explicit profile override.

    A project has either no row here (it inherits the workspace default) or
    exactly one, because repository_id is the primary key. Both foreign keys
    travel through workspace_id, so a project can only ever point at a profile
    from its own workspace.
    """

    __tablename__ = "repository_profile_assignment"

    repository_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    scoring_profile_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    repository: Mapped[Repository] = relationship(back_populates="profile_assignment")

    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "repository_id"],
            ["repository.workspace_id", "repository.id"],
            ondelete="CASCADE",
            name="fk_repository_profile_assignment_repository",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "scoring_profile_id"],
            ["scoring_profile.workspace_id", "scoring_profile.id"],
            # NO ACTION for the same reason as the workspace default above: it
            # must refuse to delete an assigned profile without blocking the
            # workspace cascade that removes this assignment in the same
            # statement.
            ondelete="NO ACTION",
            name="fk_repository_profile_assignment_scoring_profile",
        ),
    )
