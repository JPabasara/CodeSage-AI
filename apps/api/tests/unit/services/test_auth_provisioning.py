from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from codesage_api.db.models import Branch, Membership, Repository, User, Workspace
from codesage_api.services import auth

CLAIMS = auth.IdentityClaims(
    sub="asgardeo|new-user",
    email="new@example.com",
    name="New User",
    picture=None,
    identity_provider="github",
)


def _session() -> MagicMock:
    session = MagicMock(spec=Session)
    session.added = []
    session.add.side_effect = session.added.append

    def assign_ids() -> None:
        for stored in session.added:
            if getattr(stored, "id", None) is None:
                stored.id = uuid.uuid4()

    session.flush.side_effect = assign_ids
    return session


def test_first_sign_in_creates_a_ready_trial_workspace(monkeypatch) -> None:
    session = _session()
    monkeypatch.setattr(auth, "set_workspace_context", lambda *_args: None)
    seeded: list[uuid.UUID] = []
    monkeypatch.setattr(
        auth.profiles,
        "seed_workspace_profiles",
        lambda _db, workspace_id, actor_user_id=None: seeded.append(workspace_id),
    )

    auth._provision_new_user(session, CLAIMS)

    added = session.added
    assert any(isinstance(item, User) for item in added)
    workspace = next(item for item in added if isinstance(item, Workspace))
    membership = next(item for item in added if isinstance(item, Membership))
    repository = next(item for item in added if isinstance(item, Repository))
    assert workspace.name == "My Workspace"
    assert membership.role_id == "org-admin"
    assert repository.url == "https://github.com/spring-projects/spring-petclinic"
    assert repository.branches[0].name == "main"
    assert isinstance(repository.branches[0], Branch)
    assert seeded == [workspace.id]


def test_creating_a_workspace_seeds_its_pool_but_no_repository(monkeypatch) -> None:
    session = _session()
    monkeypatch.setattr(auth, "set_workspace_context", lambda *_args: None)
    seeded: list[uuid.UUID] = []
    monkeypatch.setattr(
        auth.profiles,
        "seed_workspace_profiles",
        lambda _db, workspace_id, actor_user_id=None: seeded.append(workspace_id),
    )

    workspace_id = auth._create_workspace_records(
        session,
        uuid.uuid4(),
        name="Platform Team",
        description="Everything platform",
        website_url="https://platform.example",
    )

    workspace = next(item for item in session.added if isinstance(item, Workspace))
    membership = next(item for item in session.added if isinstance(item, Membership))
    assert workspace.id == workspace_id
    assert workspace.name == "Platform Team"
    assert workspace.description == "Everything platform"
    assert workspace.website_url == "https://platform.example"
    assert membership.role_id == "org-admin"
    assert seeded == [workspace_id]
    # A new workspace is genuinely empty; the Projects page says so.
    assert not any(isinstance(item, Repository) for item in session.added)
