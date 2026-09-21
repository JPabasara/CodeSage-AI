from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import Membership, User, Workspace, WorkspaceInvitation
from codesage_api.errors import Conflict, NotFound
from codesage_api.services import audit


@dataclass(frozen=True, slots=True)
class AcceptedInvitation:
    workspace_id: uuid.UUID
    membership_id: uuid.UUID
    role_id: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


def list_members(session: Session, workspace_id: uuid.UUID):
    members = session.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.workspace_id == workspace_id)
        .order_by(User.email, Membership.id)
    ).all()
    invitations = session.scalars(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.accepted_at.is_(None),
            WorkspaceInvitation.revoked_at.is_(None),
            WorkspaceInvitation.expires_at > func.now(),
        ).order_by(WorkspaceInvitation.created_at)
    ).all()
    return members, invitations


def create_invitation(session: Session, *, workspace_id: uuid.UUID, actor_user_id: uuid.UUID,
                      email: str, role_id: str, expires_in_hours: int):
    raw_token = secrets.token_urlsafe(32)
    invitation = WorkspaceInvitation(
        workspace_id=workspace_id,
        email=normalize_email(email),
        role_id=role_id,
        token_hash=hashlib.sha256(raw_token.encode()).digest(),
        invited_by_user_id=actor_user_id,
        expires_at=datetime.now(UTC) + timedelta(hours=expires_in_hours),
    )
    try:
        with session.begin_nested():
            session.add(invitation)
            session.flush()
    except IntegrityError as exc:
        raise Conflict from exc
    audit.record(session, event_type="invitation_created", outcome="success",
                 workspace_id=workspace_id, actor_user_id=actor_user_id,
                 resource_type="workspace_invitation", resource_id=str(invitation.id))
    return invitation, raw_token


def revoke_invitation(session: Session, *, workspace_id: uuid.UUID, actor_user_id: uuid.UUID,
                      invitation_id: uuid.UUID) -> None:
    invitation = session.scalar(select(WorkspaceInvitation).where(
        WorkspaceInvitation.id == invitation_id,
        WorkspaceInvitation.workspace_id == workspace_id,
        WorkspaceInvitation.accepted_at.is_(None),
        WorkspaceInvitation.revoked_at.is_(None),
    ).with_for_update())
    if invitation is None:
        raise NotFound
    invitation.revoked_at = datetime.now(UTC)
    audit.record(session, event_type="invitation_revoked", outcome="success",
                 workspace_id=workspace_id, actor_user_id=actor_user_id,
                 resource_type="workspace_invitation", resource_id=str(invitation.id))


def accept_invitation(session: Session, *, user_id: uuid.UUID, token: str) -> AcceptedInvitation:
    from sqlalchemy import text
    row = session.execute(
        text("SELECT workspace_id, membership_id, role_id FROM app_accept_workspace_invitation(:u, :h)"),
        {"u": user_id, "h": hashlib.sha256(token.encode()).digest()},
    ).first()
    if row is None:
        raise NotFound
    return AcceptedInvitation(row.workspace_id, row.membership_id, row.role_id)


def _lock_workspace_and_target(session: Session, workspace_id: uuid.UUID,
                               membership_id: uuid.UUID) -> Membership:
    session.scalar(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update())
    target = session.scalar(select(Membership).where(
        Membership.id == membership_id, Membership.workspace_id == workspace_id
    ).with_for_update())
    if target is None:
        raise NotFound
    return target


def _protect_last_admin(session: Session, workspace_id: uuid.UUID, target: Membership) -> None:
    if target.status != MembershipStatus.ACTIVE or target.role_id != "org-admin":
        return
    count = session.scalar(select(func.count()).select_from(Membership).where(
        Membership.workspace_id == workspace_id,
        Membership.status == MembershipStatus.ACTIVE,
        Membership.role_id == "org-admin",
    ))
    if count == 1:
        raise Conflict


def change_role(session: Session, *, workspace_id: uuid.UUID, actor_user_id: uuid.UUID,
                membership_id: uuid.UUID, role_id: str) -> Membership:
    target = _lock_workspace_and_target(session, workspace_id, membership_id)
    if target.role_id == "org-admin" and role_id != "org-admin":
        _protect_last_admin(session, workspace_id, target)
    target.role_id = role_id
    audit.record(session, event_type="member_role_changed", outcome="success",
                 workspace_id=workspace_id, actor_user_id=actor_user_id,
                 resource_type="membership", resource_id=str(target.id), detail=f"role={role_id}")
    return target


def deactivate_member(session: Session, *, workspace_id: uuid.UUID, actor_user_id: uuid.UUID,
                      membership_id: uuid.UUID) -> None:
    target = _lock_workspace_and_target(session, workspace_id, membership_id)
    if target.status != MembershipStatus.ACTIVE:
        raise NotFound
    _protect_last_admin(session, workspace_id, target)
    target.status = MembershipStatus.INACTIVE
    audit.record(session, event_type="member_deactivated", outcome="success",
                 workspace_id=workspace_id, actor_user_id=actor_user_id,
                 resource_type="membership", resource_id=str(target.id))
