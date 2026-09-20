from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from codesage_api.db.models import Repository, User
from codesage_api.integrations.github import GitHubRepository
from codesage_api.services import auth


def test_provision_new_user_seeds_configured_demo_repository(monkeypatch) -> None:
    session = MagicMock(spec=Session)

    def assign_user_id() -> None:
        for call in session.add.call_args_list:
            stored = call.args[0]
            if isinstance(stored, User) and stored.id is None:
                stored.id = uuid.uuid4()

    session.flush.side_effect = assign_user_id
    monkeypatch.setattr(auth, "set_workspace_context", lambda *_args: None)
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: SimpleNamespace(
            demo_repository_url="https://github.com/example/java-demo",
            demo_repository_default_branch="main",
        ),
    )
    monkeypatch.setattr(
        auth,
        "fetch_repository",
        lambda _url: GitHubRepository(
            external_id="987654321",
            name="java-demo",
            owner="example",
            url="https://github.com/example/java-demo",
            visibility="public",
            default_branch="main",
            default_branch_sha="a" * 40,
        ),
    )

    auth._provision_new_user(
        session,
        auth.IdentityClaims(
            sub="asgardeo|demo-user",
            email="demo@example.com",
            name="Demo User",
            picture=None,
            identity_provider="github",
        ),
    )

    added = [call.args[0] for call in session.add.call_args_list]
    repository = next(item for item in added if isinstance(item, Repository))

    assert repository.owner == "example"
    assert repository.name == "java-demo"
    assert repository.url == "https://github.com/example/java-demo"
    assert repository.branches[0].name == "main"
    assert repository.branches[0].head_commit_sha == "a" * 40
