from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import Branch, Repository
from codesage_api.integrations.github import GitHubBranch, GitHubRepository
from codesage_api.scoring.enums import Grade
from codesage_api.services import repositories


def _repository(workspace_id: uuid.UUID) -> Repository:
    repository = Repository(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        source_platform=RepositoryPlatform.GITHUB,
        external_repository_id="123",
        name="CodeSage-AI",
        owner="JPabasara",
        url="https://github.com/JPabasara/CodeSage-AI",
        visibility=RepositoryVisibility.PUBLIC,
        connection_status=RepositoryConnectionStatus.CONNECTED,
        created_at=datetime(2026, 8, 25, tzinfo=UTC),
    )
    repository.branches = [
        Branch(name="main", head_commit_sha="a" * 40, is_default=True)
    ]
    return repository


def test_connect_persists_default_branch_and_audit(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    metadata = GitHubRepository(
        external_id="123",
        name="CodeSage-AI",
        owner="JPabasara",
        url="https://github.com/JPabasara/CodeSage-AI",
        visibility="public",
        default_branch="main",
        default_branch_sha="a" * 40,
    )
    monkeypatch.setattr(repositories, "fetch_repository", lambda _url: metadata)
    audit = MagicMock()
    monkeypatch.setattr(repositories.audit, "record", audit)

    def assign_generated_values() -> None:
        stored = session.add.call_args.args[0]
        stored.id = uuid.uuid4()
        stored.created_at = datetime(2026, 8, 25, tzinfo=UTC)

    session.flush.side_effect = assign_generated_values
    result = repositories.connect(
        session,
        workspace_id,
        "https://github.com/JPabasara/CodeSage-AI",
        actor_id,
    )

    stored = session.add.call_args.args[0]
    assert stored.owner == "JPabasara"
    assert stored.branches[0].name == "main"
    assert result.default_branch == "main"
    audit.assert_called_once()


def test_list_projects_derives_latest_health(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    repository = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = [repository]
    monkeypatch.setattr(
        repositories.dashboard,
        "build_scan_history",
        lambda *_args: [
            SimpleNamespace(health_score=83.0, grade=Grade.A, delta=4.0)
        ],
    )

    result = repositories.list_projects(session, workspace_id)

    assert result[0].owner == "JPabasara"
    assert result[0].latest_health is not None
    assert result[0].latest_health.score == 83.0
    assert result[0].latest_health.delta == 4.0


def test_project_without_default_branch_does_not_hide_valid_projects(
    monkeypatch,
) -> None:
    workspace_id = uuid.uuid4()
    broken = _repository(workspace_id)
    broken.branches = []
    valid = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = [broken, valid]
    monkeypatch.setattr(
        repositories.dashboard,
        "build_scan_history",
        lambda *_args: [],
    )

    result = repositories.list_projects(session, workspace_id)

    assert [project.id for project in result] == [str(valid.id)]


def test_list_branches_refreshes_heads_and_adds_new_branches(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    repository = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalar.return_value = repository
    monkeypatch.setattr(
        repositories,
        "fetch_branches",
        lambda *_args: [
            GitHubBranch(name="main", head_commit_sha="b" * 40),
            GitHubBranch(name="develop", head_commit_sha="c" * 40),
        ],
    )

    result = repositories.list_branches(session, workspace_id, repository.id)

    assert [(item.name, item.head_commit_sha) for item in result] == [
        ("main", "b" * 40),
        ("develop", "c" * 40),
    ]
    assert len(repository.branches) == 2
