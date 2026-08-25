"""Connect repositories and serve workspace-scoped project metadata."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from codesage_api.db.enums import (
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import Branch, Repository
from codesage_api.errors import (
    NotFound,
    RepositoryAlreadyConnected,
    RepositoryMissingDefaultBranch,
)
from codesage_api.integrations.github import fetch_branches, fetch_repository
from codesage_api.logging import get_logger
from codesage_api.schemas import BranchOut, LatestHealthOut, RepoOut
from codesage_api.services import audit, dashboard

logger = get_logger(__name__)


def connect(
    session: Session,
    workspace_id: uuid.UUID,
    url: str,
    actor_user_id: uuid.UUID,
) -> RepoOut:
    """Validate and persist one public GitHub repository and its default branch."""
    metadata = fetch_repository(url)
    existing = session.scalar(
        select(Repository).where(
            Repository.workspace_id == workspace_id,
            Repository.source_platform == RepositoryPlatform.GITHUB,
            Repository.external_repository_id == metadata.external_id,
        )
    )
    if existing is not None:
        raise RepositoryAlreadyConnected

    repository = Repository(
        workspace_id=workspace_id,
        source_platform=RepositoryPlatform.GITHUB,
        external_repository_id=metadata.external_id,
        name=metadata.name,
        owner=metadata.owner,
        url=metadata.url,
        visibility=RepositoryVisibility.PUBLIC,
        connection_status=RepositoryConnectionStatus.CONNECTED,
    )
    default_branch = Branch(
        name=metadata.default_branch,
        head_commit_sha=metadata.default_branch_sha,
        is_default=True,
    )
    repository.branches.append(default_branch)

    try:
        with session.begin_nested():
            session.add(repository)
            session.flush()
    except IntegrityError as exc:
        raise RepositoryAlreadyConnected from exc

    audit.record(
        session,
        event_type="repository_connected",
        outcome="success",
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        resource_type="repository",
        resource_id=str(repository.id),
    )
    return _to_output(repository, default_branch.name, latest_health=None)


def list_projects(session: Session, workspace_id: uuid.UUID) -> list[RepoOut]:
    """List repositories with health derived under the active profile."""
    statement = (
        select(Repository)
        .where(Repository.workspace_id == workspace_id)
        .options(selectinload(Repository.branches))
        .order_by(Repository.created_at.desc(), Repository.id.desc())
    )
    output: list[RepoOut] = []
    for repository in session.scalars(statement).all():
        default_branch = next(
            (branch.name for branch in repository.branches if branch.is_default), None
        )
        if default_branch is None:
            logger.error(
                "Skipping repository without a default branch",
                extra={"repository_id": str(repository.id)},
            )
            continue

        latest_health: LatestHealthOut | None = None
        try:
            history = dashboard.build_scan_history(
                session, workspace_id, repository.id, default_branch
            )
        except NotFound:
            history = []
        if history:
            latest = history[0]
            latest_health = LatestHealthOut(
                score=latest.health_score,
                grade=latest.grade,
                delta=latest.delta,
            )
        output.append(_to_output(repository, default_branch, latest_health))
    return output


def list_branches(
    session: Session,
    workspace_id: uuid.UUID,
    repository_id: uuid.UUID,
) -> list[BranchOut]:
    """Refresh GitHub branch heads for a tenant-owned repository."""
    repository = session.scalar(
        select(Repository)
        .where(
            Repository.id == repository_id,
            Repository.workspace_id == workspace_id,
        )
        .options(selectinload(Repository.branches))
    )
    if repository is None:
        raise NotFound

    default_name = next(
        (branch.name for branch in repository.branches if branch.is_default), None
    )
    if default_name is None:
        raise RepositoryMissingDefaultBranch

    existing = {branch.name: branch for branch in repository.branches}
    output: list[BranchOut] = []
    seen: set[str] = set()
    for github_branch in fetch_branches(repository.owner, repository.name):
        branch = existing.get(github_branch.name)
        is_default = github_branch.name == default_name
        if branch is None:
            branch = Branch(
                name=github_branch.name,
                head_commit_sha=github_branch.head_commit_sha,
                is_default=is_default,
            )
            repository.branches.append(branch)
        else:
            branch.head_commit_sha = github_branch.head_commit_sha
            branch.is_default = is_default
        seen.add(branch.name)
        output.append(
            BranchOut(
                name=branch.name,
                is_default=branch.is_default,
                head_commit_sha=branch.head_commit_sha,
                head_commit_at=None,
            )
        )

    for stale in repository.branches:
        if stale.name not in seen:
            session.delete(stale)
    return output


def _to_output(
    repository: Repository,
    default_branch: str,
    latest_health: LatestHealthOut | None,
) -> RepoOut:
    return RepoOut(
        id=str(repository.id),
        name=repository.name,
        owner=repository.owner,
        visibility=repository.visibility.value,
        url=repository.url,
        default_branch=default_branch,
        connected_at=repository.created_at.isoformat(),
        latest_health=latest_health,
    )
