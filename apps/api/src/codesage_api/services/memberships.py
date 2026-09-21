"""Workspace membership lifecycle and effective permission lookup.

Callers supply the authenticated user ID, never a client-selected identity.
Invitations here are membership rows already linked to that user; email/token
invitation creation and delivery are separate from this service.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, RolePermission
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import NotAuthenticated, NotFound


def get_active_membership(
    db: Session, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> Membership | None:
    """Look up membership within an already-bound workspace transaction."""
    return db.scalar(
        select(Membership)
        .where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .execution_options(populate_existing=True)
    )


def get_workspace_permissions(
    db: Session, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> frozenset[str]:
    """Only active memberships confer permissions, regardless of assigned role."""
    return frozenset(
        db.scalars(
            select(RolePermission.permission_id)
            .join(Membership, Membership.role_id == RolePermission.role_id)
            .where(
                Membership.user_id == user_id,
                Membership.workspace_id == workspace_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
    )


def accept_workspace_invitation(
    db: Session, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> Membership:
    """Accept a pending invitation linked to the authenticated user.

    Run in a dedicated transaction: this binds its RLS workspace. The stored
    invitation role is authoritative; the caller cannot supply a replacement.
    A row lock serializes acceptance against revocation and role changes.
    Missing, already accepted, or inactive memberships cannot be accepted.
    The caller owns commit/rollback, allowing audit/session changes atomically.
    """
    set_workspace_context(db, workspace_id)
    membership = db.scalar(
        select(Membership)
        .where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
            Membership.status == MembershipStatus.INVITED,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None:
        raise NotFound
    membership.status = MembershipStatus.ACTIVE
    db.flush()
    return membership


def resolve_authorization_context(
    db: Session, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> AuthorizationContext:
    """Read membership, role and grants together in the bound data transaction.

    An outer join preserves valid roles with no grants. One query ensures the
    role and permissions come from the same database statement snapshot.
    """
    rows = db.execute(
        select(Membership.id, Membership.role_id, RolePermission.permission_id)
        .outerjoin(RolePermission, RolePermission.role_id == Membership.role_id)
        .where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    ).all()
    if not rows:
        raise NotAuthenticated
    return AuthorizationContext(
        user_id=user_id,
        workspace_id=workspace_id,
        membership_id=rows[0].id,
        role_id=rows[0].role_id,
        permissions=frozenset(row.permission_id for row in rows if row.permission_id is not None),
    )
