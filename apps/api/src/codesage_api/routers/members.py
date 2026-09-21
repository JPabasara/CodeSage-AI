from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.config import get_settings
from codesage_api.db.session import SessionLocal
from codesage_api.deps import get_current_user_id, get_db, require_permission
from codesage_api.errors import NotFound
from codesage_api.integrations.resend import send_workspace_invitation
from codesage_api.schemas.members import (
    AcceptedInvitationOut,
    AcceptInvitationIn,
    ChangeMemberRoleIn,
    CreatedInvitationOut,
    CreateInvitationIn,
    InvitationOut,
    MemberListOut,
    MemberOut,
    RoleName,
)
from codesage_api.services import member_admin

router = APIRouter(tags=["members"])
MemberReader = Annotated[AuthorizationContext, Depends(require_permission("member:read"))]
MemberManager = Annotated[AuthorizationContext, Depends(require_permission("member:manage"))]
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[uuid.UUID, Depends(get_current_user_id)]


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise NotFound from exc


@router.get("/members", response_model=MemberListOut)
def list_members(
    context: MemberReader,
    db: Database,
) -> MemberListOut:
    members, invitations = member_admin.list_members(db, context.workspace_id)
    return MemberListOut(
        members=[MemberOut(membership_id=str(m.id), user_id=str(m.user_id), email=u.email,
                           name=u.display_name, role=m.role_id, status=m.status.value)
                 for m, u in members],
        pending_invitations=[InvitationOut(invitation_id=str(i.id), email=i.email,
                                           role=i.role_id, expires_at=i.expires_at)
                             for i in invitations],
    )


@router.post("/invitations", response_model=CreatedInvitationOut, status_code=201)
def invite_member(
    body: CreateInvitationIn,
    context: MemberManager,
    db: Database,
) -> CreatedInvitationOut:
    invitation, token = member_admin.create_invitation(
        db, workspace_id=context.workspace_id, actor_user_id=context.user_id,
        email=body.email, role_id=body.role, expires_in_hours=body.expires_in_hours,
    )
    url = f"{get_settings().frontend_base_url}/invitations/accept?token={token}"
    send_workspace_invitation(
        recipient=invitation.email,
        invitation_url=url,
        invitation_id=invitation.id,
    )
    return CreatedInvitationOut(invitation_id=str(invitation.id), email=invitation.email,
                                role=invitation.role_id, expires_at=invitation.expires_at,
                                invitation_url=url)


@router.delete("/invitations/{invitation_id}", status_code=204)
def revoke_invitation(
    invitation_id: str,
    context: MemberManager,
    db: Database,
) -> Response:
    member_admin.revoke_invitation(db, workspace_id=context.workspace_id,
                                   actor_user_id=context.user_id,
                                   invitation_id=_uuid(invitation_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invitations/accept", response_model=AcceptedInvitationOut)
def accept_invitation(
    body: AcceptInvitationIn,
    user_id: CurrentUser,
) -> AcceptedInvitationOut:
    db = SessionLocal()
    try:
        accepted = member_admin.accept_invitation(db, user_id=user_id, token=body.token)
        db.commit()
        return AcceptedInvitationOut(workspace_id=str(accepted.workspace_id),
                                     membership_id=str(accepted.membership_id),
                                     role=cast(RoleName, accepted.role_id))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.patch("/members/{membership_id}/role", response_model=MemberOut)
def change_member_role(
    membership_id: str, body: ChangeMemberRoleIn,
    context: MemberManager,
    db: Database,
) -> MemberOut:
    membership = member_admin.change_role(db, workspace_id=context.workspace_id,
        actor_user_id=context.user_id, membership_id=_uuid(membership_id), role_id=body.role)
    user = membership.user
    return MemberOut(membership_id=str(membership.id), user_id=str(membership.user_id),
                     email=user.email, name=user.display_name,
                     role=cast(RoleName, membership.role_id),
                     status=membership.status.value)


@router.delete("/members/{membership_id}", status_code=204)
def deactivate_member(
    membership_id: str,
    context: MemberManager,
    db: Database,
) -> Response:
    member_admin.deactivate_member(db, workspace_id=context.workspace_id,
        actor_user_id=context.user_id, membership_id=_uuid(membership_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
