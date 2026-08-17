"""RepositoryService — connect repositories and read branch information (FR-3, FR-5)."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import Repository
from codesage_api.schemas import BranchOut, RepoOut


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


def list_projects(session: Session, workspace_id: uuid.UUID) -> list[RepoOut]:
    """Connected projects with their derived health hint (FR-4)."""
    raise NotImplementedError


def list_branches(session: Session, repository_id: uuid.UUID) -> list[BranchOut]:
    """Branches with head SHAs, refreshed from GitHub with ETag conditional requests.

    One of only two places the system calls the REST API at all — the pipeline runs
    off a clone and consumes no quota. That is why SAD §10 describes rate limits as
    avoided rather than managed.
    """
    raise NotImplementedError
