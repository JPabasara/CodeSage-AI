from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import repository_context
from codesage_api.authorization.context import AuthorizationContext
from codesage_api.deps import get_authorization_context, get_current_user_id, get_db, get_workspace_id
from codesage_api.main import create_app
from codesage_api.services import analysis


def _client() -> tuple[TestClient, MagicMock, uuid.UUID]:
    app = create_app()
    db = MagicMock(spec=Session)
    workspace_id = uuid.uuid4()

    def database() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_authorization_context] = lambda: AuthorizationContext(
        user_id=uuid.uuid4(), workspace_id=workspace_id, membership_id=uuid.uuid4(),
        role_id="org-admin", permissions=frozenset({
            "project:read", "repository:connect", "profile:read", "profile:update", "history:read"
        }),
    )
    app.dependency_overrides[repository_context] = app.dependency_overrides[get_authorization_context]
    return TestClient(app), db, workspace_id


def test_scan_history_allows_omitting_branch(monkeypatch) -> None:
    client, db, workspace_id = _client()
    repository_id = uuid.uuid4()
    calls: list[str | None] = []

    def get_history(
        session: Session,
        workspace: uuid.UUID,
        repository: uuid.UUID,
        branch: str | None,
    ) -> list[object]:
        assert session is db
        assert workspace == workspace_id
        assert repository == repository_id
        calls.append(branch)
        return []

    monkeypatch.setattr(analysis, "get_history", get_history)

    with client:
        all_branches = client.get(f"/api/repos/{repository_id}/scans")
        main_only = client.get(f"/api/repos/{repository_id}/scans", params={"branch": "main"})

    assert all_branches.status_code == 200
    assert main_only.status_code == 200
    assert calls == [None, "main"]
