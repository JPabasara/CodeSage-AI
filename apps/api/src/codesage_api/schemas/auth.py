"""What `GET /api/auth/session` and the workspace endpoints return.

Carries no token and no password. Those never leave this server (SEC-09).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import AnyHttpUrl, Field, TypeAdapter, field_validator

from codesage_api.schemas.base import ApiModel

_URL = TypeAdapter(AnyHttpUrl)


def _clean(value: str | None, *, field: str) -> str | None:
    """Trim, and treat an all-whitespace value as absent rather than as content."""
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if field == "website_url":
        try:
            _URL.validate_python(stripped)
        except ValueError as exc:
            raise ValueError("Website must be a valid http(s) URL.") from exc
    return stripped


class WorkspaceSummaryOut(ApiModel):
    """One workspace as the switcher and the Workspace screen need it.

    `project_count` and `member_count` are derived on read rather than stored:
    both change whenever a project or a member does, and a stored copy would be
    wrong more often than right.
    """

    workspace_id: str
    name: str
    role: str
    is_active: bool
    description: str | None = None
    website_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    project_count: int = 0
    member_count: int = 0


class CreateWorkspaceIn(ApiModel):
    """The body of `POST /api/auth/workspaces`, and of onboarding.

    Only the name is required. A workspace is identified by what the team calls
    it; everything else is decoration the Workspace screen can fill in later.
    """

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    website_url: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Workspace name cannot be blank.")
        return stripped

    @field_validator("description", "website_url")
    @classmethod
    def normalize_optional(cls, value: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _clean(value, field=info.field_name)


class UpdateWorkspaceIn(ApiModel):
    """The body of `PATCH /api/auth/workspaces/{id}` — a partial update.

    Every field is optional and an omitted one is left alone, so the Workspace
    form can send only what the user touched. Sending `null` for description or
    website clears it; that is a real intention and is distinguishable from
    omission, which is why they are not merged into one meaning.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    website_url: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Workspace name cannot be blank.")
        return stripped

    @field_validator("description", "website_url")
    @classmethod
    def normalize_optional(cls, value: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _clean(value, field=info.field_name)


class SwitchWorkspaceIn(ApiModel):
    workspace_id: str


class SessionOut(ApiModel):
    """The signed-in user, and where they are allowed to act.

    Only `user_id` is guaranteed. `workspace_id` is null for a user who has
    signed in but has no workspace yet — a real authenticated state, not a
    failure, and the one `needs_workspace_setup` exists to name so the web never
    has to infer onboarding from a missing field.

    Everything below that comes from the identity provider and may simply be
    absent — a GitHub account can keep its email private and need never set a
    display name. Identity here is `asgardeo_sub` and nothing else, so a missing
    display name is a cosmetic gap, not a failed sign-in. Requiring it would turn
    one into the other: the user signs in successfully and then this endpoint
    returns 500 because its own response model rejects the answer.
    """

    user_id: str
    workspace_id: str | None = None
    needs_workspace_setup: bool = False

    # The caller's standing in the active workspace. Sent so the web can hide
    # controls it would be refused anyway — a convenience, never the boundary.
    # The API re-checks every permission on every request regardless.
    role: str | None = None
    permissions: list[str] = Field(default_factory=list)

    # Display only. Render a fallback rather than assuming these are present.
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    identity_provider: str | None = None
