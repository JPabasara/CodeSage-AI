"""Global, migration-managed RBAC catalogue; assignments live on memberships."""

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from codesage_api.db.base import Base


class Role(Base):
    __tablename__ = "role"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)


class Permission(Base):
    __tablename__ = "permission"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)


class RolePermission(Base):
    __tablename__ = "role_permission"

    role_id: Mapped[str] = mapped_column(
        ForeignKey("role.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[str] = mapped_column(
        ForeignKey("permission.id", ondelete="CASCADE"), primary_key=True
    )
