"""Immutable authorization snapshot for one request, never a session cache."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TypeVar

from codesage_api.errors import Forbidden, NotFound

Resource = TypeVar("Resource")


@dataclass(frozen=True, slots=True)
class AuthorizationContext:
    """Authenticated identity and active workspace membership, represented by IDs."""

    user_id: uuid.UUID
    workspace_id: uuid.UUID
    membership_id: uuid.UUID
    role_id: str
    permissions: frozenset[str]

    def require_permission(self, permission: str) -> None:
        """Unknown and unassigned permissions fail closed."""
        if permission not in self.permissions:
            raise Forbidden

    def require_resource(
        self, resource: Resource | None, *, resource_workspace_id: uuid.UUID | None
    ) -> Resource:
        """Use trusted database ownership, not a workspace ID from the client.

        Resolve descendants through their parent repository. Missing resources
        and resources belonging to another workspace produce the same 404.
        Check resource visibility before operation permissions for an existing
        resource, so callers cannot distinguish another tenant's IDs.
        """
        if resource is None or resource_workspace_id != self.workspace_id:
            raise NotFound
        return resource
