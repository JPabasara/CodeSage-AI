"""Resource-first authorization dependencies for repository and scan routes."""

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from codesage_api.authorization.context import AuthorizationContext
from codesage_api.db.models import AnalysisAttempt, Repository, Snapshot
from codesage_api.db.repositories import attempts
from codesage_api.deps import get_authorization_context, get_db
from codesage_api.errors import Forbidden, NotFound


def repository_context(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    context: Annotated[AuthorizationContext, Depends(get_authorization_context)],
) -> AuthorizationContext:
    repository = db.get(Repository, repo_id)
    context.require_resource(
        repository,
        resource_workspace_id=repository.workspace_id if repository else None,
    )
    return context


def require_repository_permission(permission: str) -> Callable[..., AuthorizationContext]:
    def check(
        context: Annotated[AuthorizationContext, Depends(repository_context)],
    ) -> AuthorizationContext:
        context.require_permission(permission)
        return context

    return check


def visible_scan(
    repo_id: uuid.UUID,
    scan_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    context: Annotated[AuthorizationContext, Depends(repository_context)],
) -> AnalysisAttempt:
    attempt = attempts.get_for_repository(db, context.workspace_id, repo_id, scan_id)
    if attempt is None:
        raise NotFound
    return attempt


def require_scan_read(
    attempt: Annotated[AnalysisAttempt, Depends(visible_scan)],
    context: Annotated[AuthorizationContext, Depends(get_authorization_context)],
) -> AuthorizationContext:
    context.require_permission("result:read")
    return context


def require_scan_cancel(
    attempt: Annotated[AnalysisAttempt, Depends(visible_scan)],
    context: Annotated[AuthorizationContext, Depends(get_authorization_context)],
) -> AuthorizationContext:
    if "scan:cancel_any" in context.permissions:
        return context
    if "scan:cancel_own" in context.permissions and attempt.initiated_by_user_id == context.user_id:
        return context
    raise Forbidden


def require_health_read(
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    context: Annotated[AuthorizationContext, Depends(repository_context)],
    snapshot_id: uuid.UUID | None = None,
) -> AuthorizationContext:
    stored_branch = attempts.get_branch(db, context.workspace_id, repo_id, branch)
    if stored_branch is None:
        raise NotFound
    if snapshot_id is not None:
        snapshot = db.scalar(
            select(Snapshot.id)
            .join(AnalysisAttempt, Snapshot.analysis_attempt_id == AnalysisAttempt.id)
            .where(Snapshot.id == snapshot_id, AnalysisAttempt.branch_id == stored_branch.id)
        )
        if snapshot is None:
            raise NotFound
    context.require_permission("result:read")
    return context
