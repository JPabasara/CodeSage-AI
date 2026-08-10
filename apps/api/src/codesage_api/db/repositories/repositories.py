"""REPOSITORY and BRANCH queries."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from codesage_api.db.models import Branch, Repository


def list_for_workspace(session: Session, workspace_id: uuid.UUID) -> list[Repository]:
    """Every connected project (FR-4).

    RLS already scopes this; the explicit predicate is belt-and-braces so the query
    stays correct if it is ever run as a role that bypasses policies — a migration,
    a fixture loader, a psql session.
    """
    raise NotImplementedError


def get(session: Session, repository_id: uuid.UUID) -> Repository | None:
    raise NotImplementedError


def create(session: Session, workspace_id: uuid.UUID, metadata: dict) -> Repository:
    """Connect a repository by URL (FR-3). Rejects non-public repositories upstream."""
    raise NotImplementedError


def list_branches(session: Session, repository_id: uuid.UUID) -> list[Branch]:
    raise NotImplementedError


def upsert_branches(session: Session, repository_id: uuid.UUID, branches: list[dict]) -> None:
    """Refresh the branch list and head SHAs from GitHub REST metadata (FR-5)."""
    raise NotImplementedError
