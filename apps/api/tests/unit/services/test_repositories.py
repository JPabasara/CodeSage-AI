from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from codesage_api.db.enums import (
    RepositoryConnectionStatus,
    RepositoryPlatform,
    RepositoryVisibility,
)
from codesage_api.db.models import Branch, Repository
from codesage_api.errors import (
    NotFound,
    RepositoryAlreadyConnected,
    RepositoryHasNoJava,
    RepositoryScanRunning,
    RepositoryTooLarge,
)
from codesage_api.integrations.github import GitHubBranch, GitHubRepository
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
    repository.branches = [Branch(name="main", head_commit_sha="a" * 40, is_default=True)]
    return repository


def test_disconnect_deletes_repository_and_records_audit(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    repository = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalar.side_effect = [repository, None]
    record = MagicMock()
    monkeypatch.setattr(repositories.audit, "record", record)

    repositories.disconnect(session, workspace_id, repository.id, actor_id)

    session.delete.assert_called_once_with(repository)
    session.flush.assert_called_once()
    record.assert_called_once()


def test_disconnect_refuses_active_scan() -> None:
    workspace_id = uuid.uuid4()
    repository = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalar.side_effect = [repository, uuid.uuid4()]

    with pytest.raises(RepositoryScanRunning):
        repositories.disconnect(session, workspace_id, repository.id, uuid.uuid4())

    session.delete.assert_not_called()


def test_disconnect_hides_missing_or_foreign_repository() -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None

    with pytest.raises(NotFound):
        repositories.disconnect(session, uuid.uuid4(), uuid.uuid4(), uuid.uuid4())

    session.delete.assert_not_called()


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
        size_kb=4_096,
        languages=("Java", "Kotlin"),
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


def test_list_projects_uses_cached_latest_health(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    repository = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = [repository]
    monkeypatch.setattr(
        repositories.profiles,
        "load_pool",
        lambda *_args: SimpleNamespace(for_repository=lambda _id: object()),
    )
    monkeypatch.setattr(
        repositories.profiles, "to_scoring_profile", lambda *_args: object()
    )
    monkeypatch.setattr(
        repositories.dashboard,
        "build_latest_health_hint",
        lambda *_args: (
            (SimpleNamespace(health_score=83.0, grade="A"), 4.0),
            [],
        ),
    )
    result = repositories.list_projects(session, workspace_id)

    assert result[0].owner == "JPabasara"
    assert result[0].latest_health is not None
    assert result[0].latest_health.score == 83.0
    assert result[0].latest_health.delta == 4.0


def test_project_without_default_branch_does_not_hide_valid_projects(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    broken = _repository(workspace_id)
    broken.branches = []
    valid = _repository(workspace_id)
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = [broken, valid]
    monkeypatch.setattr(
        repositories.profiles,
        "load_pool",
        lambda *_args: SimpleNamespace(for_repository=lambda _id: object()),
    )
    monkeypatch.setattr(
        repositories.profiles, "to_scoring_profile", lambda *_args: object()
    )
    monkeypatch.setattr(
        repositories.dashboard,
        "build_latest_health_hint",
        lambda *_args: (None, []),
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


# ── 13H.1 connect-time guardrails ───────────────────────────────────────────


def _metadata(*, size_kb: int = 1_024, languages: tuple[str, ...] = ("Java",)) -> GitHubRepository:
    return GitHubRepository(
        external_id="123",
        name="CodeSage-AI",
        owner="JPabasara",
        url="https://github.com/JPabasara/CodeSage-AI",
        visibility="public",
        default_branch="main",
        default_branch_sha="a" * 40,
        size_kb=size_kb,
        languages=languages,
    )


def _connect(monkeypatch, metadata: GitHubRepository) -> tuple[MagicMock, MagicMock]:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    monkeypatch.setattr(repositories, "fetch_repository", lambda _url: metadata)
    audit = MagicMock()
    monkeypatch.setattr(repositories.audit, "record", audit)

    def assign_generated_values() -> None:
        stored = session.add.call_args.args[0]
        stored.id = uuid.uuid4()
        stored.created_at = datetime(2026, 9, 25, tzinfo=UTC)

    session.flush.side_effect = assign_generated_values
    repositories.connect(session, uuid.uuid4(), metadata.url, uuid.uuid4())
    return session, audit


def test_connect_refuses_a_repository_over_the_size_limit(monkeypatch) -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    monkeypatch.setattr(
        repositories, "fetch_repository", lambda _url: _metadata(size_kb=300 * 1024 + 1)
    )
    audit = MagicMock()
    monkeypatch.setattr(repositories.audit, "record", audit)

    with pytest.raises(RepositoryTooLarge) as refused:
        repositories.connect(session, uuid.uuid4(), "https://github.com/a/b", uuid.uuid4())

    assert refused.value.code == "REPOSITORY_TOO_LARGE"
    assert refused.value.message == (
        "This repository is larger than 300 MB, the most CodeSage can analyse today."
    )
    # No project, and nothing recorded as connected.
    session.add.assert_not_called()
    session.flush.assert_not_called()
    audit.assert_not_called()


def test_connect_accepts_a_repository_exactly_at_the_size_limit(monkeypatch) -> None:
    session, audit = _connect(monkeypatch, _metadata(size_kb=300 * 1024))

    session.add.assert_called_once()
    audit.assert_called_once()


def test_connect_refuses_a_repository_with_no_java_and_lists_what_it_has(monkeypatch) -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    monkeypatch.setattr(
        repositories,
        "fetch_repository",
        lambda _url: _metadata(languages=("Python", "Shell")),
    )
    audit = MagicMock()
    monkeypatch.setattr(repositories.audit, "record", audit)

    with pytest.raises(RepositoryHasNoJava) as refused:
        repositories.connect(session, uuid.uuid4(), "https://github.com/a/b", uuid.uuid4())

    assert refused.value.body() == {
        "detail": (
            "We couldn't find any Java in this repository. "
            "CodeSage reads Java for now; more languages are coming soon."
        ),
        "code": "REPOSITORY_HAS_NO_JAVA",
        "languages": ["Python", "Shell"],
    }
    session.add.assert_not_called()
    audit.assert_not_called()


def test_an_empty_repository_has_no_java_either(monkeypatch) -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    monkeypatch.setattr(repositories, "fetch_repository", lambda _url: _metadata(languages=()))

    with pytest.raises(RepositoryHasNoJava) as refused:
        repositories.connect(session, uuid.uuid4(), "https://github.com/a/b", uuid.uuid4())

    assert refused.value.languages == []
    session.add.assert_not_called()


def test_java_anywhere_in_the_language_list_is_enough(monkeypatch) -> None:
    # A mostly-Kotlin Android app with some Java is still worth analysing.
    session, _audit = _connect(monkeypatch, _metadata(languages=("Kotlin", "Java")))

    session.add.assert_called_once()


def test_the_size_limit_is_a_setting_not_a_constant(monkeypatch) -> None:
    from codesage_api.config import Settings

    monkeypatch.setattr(
        repositories, "get_settings", lambda: Settings(max_repository_size_mb=10)
    )
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    monkeypatch.setattr(
        repositories, "fetch_repository", lambda _url: _metadata(size_kb=11 * 1024)
    )

    with pytest.raises(RepositoryTooLarge) as refused:
        repositories.connect(session, uuid.uuid4(), "https://github.com/a/b", uuid.uuid4())

    assert "larger than 10 MB" in refused.value.message


def test_an_already_connected_repository_still_says_so_first(monkeypatch) -> None:
    """Connected before the guardrails existed: "already connected" is the truer
    answer than "too large" for a repository that is right there in the list."""
    session = MagicMock(spec=Session)
    session.scalar.return_value = object()
    monkeypatch.setattr(
        repositories, "fetch_repository", lambda _url: _metadata(size_kb=10**9, languages=())
    )

    with pytest.raises(RepositoryAlreadyConnected):
        repositories.connect(session, uuid.uuid4(), "https://github.com/a/b", uuid.uuid4())
