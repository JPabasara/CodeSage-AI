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
from codesage_api.schemas import ActivityOut, ScanStatusOut
from codesage_api.scoring.enums import ScanPhase
from codesage_api.services import analysis


_EVERY_PERMISSION = frozenset(
    {
        "project:read",
        "repository:connect",
        "profile:read",
        "profile:update",
        "history:read",
        "result:read",
    }
)


def _client(
    permissions: frozenset[str] = _EVERY_PERMISSION,
) -> tuple[TestClient, MagicMock, uuid.UUID]:
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
        role_id="org-admin", permissions=permissions,
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


def test_active_scan_is_returned_and_is_not_taken_for_a_scan_id(monkeypatch) -> None:
    """`/scan/active` must reach its own route. Registered after `/scan/{scan_id}`
    it would be parsed as an id and answer 422."""
    client, db, workspace_id = _client()
    repository_id = uuid.uuid4()
    calls: list[str | None] = []

    def get_active(session, workspace, repository, branch):
        assert (session, workspace, repository) == (db, workspace_id, repository_id)
        calls.append(branch)
        return ScanStatusOut(
            scan_id=str(uuid.uuid4()), phase=ScanPhase.RUNNING, progress=40, branch="main"
        )

    monkeypatch.setattr(analysis, "get_active", get_active)

    with client:
        any_branch = client.get(f"/api/repos/{repository_id}/scan/active")
        main = client.get(f"/api/repos/{repository_id}/scan/active", params={"branch": "main"})

    assert any_branch.status_code == 200
    assert any_branch.json()["phase"] == "running"
    assert main.status_code == 200
    assert calls == [None, "main"]


def test_no_active_scan_is_204(monkeypatch) -> None:
    client, _db, _workspace_id = _client()
    monkeypatch.setattr(analysis, "get_active", lambda *args: None)

    with client:
        response = client.get(f"/api/repos/{uuid.uuid4()}/scan/active")

    assert response.status_code == 204
    assert response.content == b""


def test_service_finds_the_active_scan_per_branch_or_across_the_repository(
    monkeypatch,
) -> None:
    from types import SimpleNamespace

    from codesage_api.db.repositories import attempts
    from codesage_api.errors import NotFound

    running = SimpleNamespace(branch=SimpleNamespace(name="develop"))
    monkeypatch.setattr(analysis, "_status_out", lambda attempt, name: name)
    monkeypatch.setattr(attempts, "find_active_for_repository", lambda *a: running)
    monkeypatch.setattr(
        attempts,
        "get_branch",
        lambda s, w, r, name: SimpleNamespace(id=name) if name != "gone" else None,
    )
    monkeypatch.setattr(
        attempts,
        "find_active_for_branch",
        lambda s, branch_id: running if branch_id == "develop" else None,
    )

    db = MagicMock(spec=Session)
    workspace_id, repository_id = uuid.uuid4(), uuid.uuid4()
    assert analysis.get_active(db, workspace_id, repository_id, None) == "develop"
    assert analysis.get_active(db, workspace_id, repository_id, "develop") == "develop"
    assert analysis.get_active(db, workspace_id, repository_id, "main") is None
    try:
        analysis.get_active(db, workspace_id, repository_id, "gone")
    except NotFound:
        pass
    else:
        raise AssertionError("an unknown branch must be a 404")


def test_activity_lists_the_workspace_work_in_progress(monkeypatch) -> None:
    client, db, workspace_id = _client()
    calls: list[tuple[object, uuid.UUID]] = []

    def list_activity(session, workspace):
        calls.append((session, workspace))
        return ActivityOut(scans=[], rescoring=[])

    monkeypatch.setattr(analysis, "list_activity", list_activity)

    with client:
        response = client.get("/api/activity")

    assert response.status_code == 200
    # Both lists are always present, even when nothing runs.
    assert response.json() == {"scans": [], "rescoring": []}
    assert calls == [(db, workspace_id)]


def test_activity_needs_result_read(monkeypatch) -> None:
    """A member who may not read results must not learn what is being scanned."""
    client, _db, _workspace_id = _client(frozenset({"project:read"}))
    list_activity = MagicMock(side_effect=AssertionError("reached the service"))
    monkeypatch.setattr(analysis, "list_activity", list_activity)

    with client:
        response = client.get("/api/activity")

    assert response.status_code == 403
    list_activity.assert_not_called()
