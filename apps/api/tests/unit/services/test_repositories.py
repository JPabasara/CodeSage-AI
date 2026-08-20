from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import Branch, Repository
from codesage_api.errors import RepositoryMissingDefaultBranch
from codesage_api.services.repositories import list_projects


def make_repository(
    *,
    workspace_id: uuid.UUID,
    default_branch: str | None = "main",
) -> Repository:
    repository = Repository(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        source_platform=RepositoryPlatform.GITHUB,
        external_repository_id="123456",
        name="codesage",
        owner="group-16",
        url="https://github.com/group-16/codesage",
        visibility=RepositoryVisibility.PUBLIC,
        connection_status=RepositoryConnectionStatus.CONNECTED,
        created_at=datetime(2026, 8, 20, 10, 30, tzinfo=timezone.utc),
    )

    repository.branches = []

    if default_branch is not None:
        repository.branches.append(
            Branch(
                id=uuid.uuid4(),
                name=default_branch,
                head_commit_sha="a" * 40,
                is_default=True,
            )
        )

    return repository


def make_session_returning(
    repositories: list[Repository],
) -> MagicMock:
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = repositories
    return session


def test_list_projects_returns_empty_list() -> None:
    workspace_id = uuid.uuid4()
    session = make_session_returning([])

    result = list_projects(session, workspace_id)

    assert result == []


def test_list_projects_maps_repository_to_response() -> None:
    workspace_id = uuid.uuid4()
    repository = make_repository(workspace_id=workspace_id)
    session = make_session_returning([repository])

    result = list_projects(session, workspace_id)

    assert len(result) == 1

    project = result[0]

    assert project.id == str(repository.id)
    assert project.name == "codesage"
    assert project.owner == "group-16"
    assert project.visibility == "public"
    assert project.url == "https://github.com/group-16/codesage"
    assert project.default_branch == "main"
    assert project.connected_at == "2026-08-20T10:30:00+00:00"
    assert project.latest_health is None


def test_list_projects_uses_default_branch() -> None:
    workspace_id = uuid.uuid4()
    repository = make_repository(workspace_id=workspace_id)

    repository.branches.append(
        Branch(
            id=uuid.uuid4(),
            name="development",
            head_commit_sha="b" * 40,
            is_default=False,
        )
    )

    session = make_session_returning([repository])

    result = list_projects(session, workspace_id)

    assert result[0].default_branch == "main"


def test_list_projects_filters_using_workspace_id() -> None:
    workspace_id = uuid.uuid4()
    session = make_session_returning([])

    list_projects(session, workspace_id)

    statement = session.scalars.call_args.args[0]
    compiled = statement.compile()

    assert workspace_id in compiled.params.values()
    assert "repository.workspace_id" in str(statement)


def test_missing_default_branch_is_an_internal_error() -> None:
    workspace_id = uuid.uuid4()
    repository = make_repository(
        workspace_id=workspace_id,
        default_branch=None,
    )
    session = make_session_returning([repository])

    with pytest.raises(RepositoryMissingDefaultBranch):
        list_projects(session, workspace_id)