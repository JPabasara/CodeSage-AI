from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from codesage_api.schemas.base import ApiModel

RoleName = Literal["org-admin", "manager", "developer", "viewer"]


class MemberOut(ApiModel):
    membership_id: str
    user_id: str
    email: str | None
    name: str | None
    role: RoleName
    status: Literal["active", "inactive", "invited"]


class InvitationOut(ApiModel):
    invitation_id: str
    email: str
    role: RoleName
    expires_at: datetime


class MemberListOut(ApiModel):
    members: list[MemberOut]
    pending_invitations: list[InvitationOut]


class CreateInvitationIn(ApiModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: RoleName
    expires_in_hours: int = Field(default=72, ge=1, le=168)


class CreatedInvitationOut(InvitationOut):
    invitation_url: str


class AcceptInvitationIn(ApiModel):
    token: str = Field(min_length=32, max_length=512)


class AcceptedInvitationOut(ApiModel):
    workspace_id: str
    membership_id: str
    role: RoleName


class ChangeMemberRoleIn(ApiModel):
    role: RoleName
