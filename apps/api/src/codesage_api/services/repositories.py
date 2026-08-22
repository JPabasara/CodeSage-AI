"""RepositoryService — connect repositories and read branch information (FR-3, FR-5)."""

from __future__ import annotations

import uuid
from sqlalchemy import select 
from sqlalchemy.orm import Session, selectinload

from codesage_api.db.models import Repository
from codesage_api.schemas import BranchOut, RepoOut
from codesage_api.errors import RepositoryMissingDefaultBranch

def connect(session: Session, workspace_id: uuid.UUID, url: str) -> Repository:
    """Validate a pasted URL, read its metadata from GitHub, create the project.

    Rejects, with a message that says why:
      * a malformed or non-GitHub URL
      * a repository that does not exist or is unreachable
      * a **private** repository — that needs the GitHub App installation flow,
        which is not in v1.0. Failing here, at connect time, is the whole point:
        the alternative is a clone that fails opaquely minutes into a scan.
      * a repository already connected to this workspace

    Writes a SecurityAuditRecord for the connection.
    """
    raise NotImplementedError


def list_projects( session: Session, workspace_id: uuid.UUID) -> list[RepoOut]:
    statement = (
        select(Repository)
        .where(Repository.workspace_id == workspace_id)
        .options(selectinload(Repository.branches))
        .order_by(Repository.created_at.desc())
    )

    repositories = session.scalars(statement).all()

    projects: list[RepoOut] = []

    for repository in repositories:
        default_branch = next(
            (
                branch.name
                for branch in repository.branches
                if branch.is_default
            ),
            None,
        )

        if default_branch is None:
            raise RepositoryMissingDefaultBranch

        projects.append(
            RepoOut(
                id=str(repository.id),
                name=repository.name,
                owner=repository.owner,
                visibility=repository.visibility.value,
                url=repository.url,
                default_branch=default_branch,
                connected_at=repository.created_at.isoformat(),
                latest_health=None,
            )
        )

    return projects

def list_branches(session: Session, repository_id: uuid.UUID) -> list[BranchOut]:
    """Branches with head SHAs, refreshed from GitHub with ETag conditional requests.

    One of only two places the system calls the REST API at all — the pipeline runs
    off a clone and consumes no quota. That is why SAD §10 describes rate limits as
    avoided rather than managed.
    """
    raise NotImplementedError
