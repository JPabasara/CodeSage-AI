"""Dashboard reads answer 304 to a current copy and reuse finished bytes."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.authorization.routes import require_health_read
from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.errors import PermissionDenied
from codesage_api.main import create_app
from codesage_api.schemas import FindingPageOut, HealthReportOut
from codesage_api.services import dashboard, response_cache
from codesage_api.services.dashboard import PreparedRead

REPO = uuid.uuid4()


def _report() -> HealthReportOut:
    return HealthReportOut.model_validate(
        {
            "snapshot_id": str(uuid.uuid4()),
            "repo_id": str(REPO),
            "branch": "main",
            "commit_sha": "a" * 40,
            "scanned_at": "2026-10-04T10:00:00+00:00",
            "health_score": 81.0,
            "grade": "B",
            "delta": 3.0,
            "red_issue_count": 9,
            "profile": "Balanced",
            "history": [],
            "tree": [],
            "file_scores": [],
            "findings": [],
            "category_breakdown": [],
        }
    )


@pytest.fixture(autouse=True)
def _empty_cache() -> Iterator[None]:
    response_cache.responses.clear()
    yield
    response_cache.responses.clear()


@pytest.fixture
def state(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """What the prepared read reports, and how often the expensive part ran."""
    shared: dict[str, object] = {"version": ("v1",), "builds": 0, "report": _report()}

    def prepare(*_args: object, **_kwargs: object) -> PreparedRead[HealthReportOut]:
        def build() -> HealthReportOut:
            shared["builds"] = int(shared["builds"]) + 1  # type: ignore[call-overload]
            return shared["report"]  # type: ignore[return-value]

        return PreparedRead(version=lambda: shared["version"], build=build)  # type: ignore[arg-type,return-value]

    def prepare_page(*_args: object, **_kwargs: object) -> PreparedRead[FindingPageOut]:
        def build() -> FindingPageOut:
            shared["builds"] = int(shared["builds"]) + 1  # type: ignore[call-overload]
            return FindingPageOut(items=[], total=0, limit=25, offset=0)

        return PreparedRead(version=lambda: shared["version"], build=build)  # type: ignore[arg-type,return-value]

    monkeypatch.setattr(dashboard, "prepare_health_report", prepare)
    monkeypatch.setattr(dashboard, "prepare_findings_page", prepare_page)
    return shared


def _client(monkeypatch: pytest.MonkeyPatch, *, allowed: bool = True) -> TestClient:
    app = create_app()

    def database() -> Iterator[Session]:
        yield MagicMock(spec=Session)

    def access() -> None:
        if not allowed:
            raise PermissionDenied(
                user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), permission="result:read"
            )

    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_workspace_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_health_read] = access
    # The 403 handler audits in its own session; keep it off the real database.
    monkeypatch.setattr(deps, "SessionLocal", MagicMock())
    return TestClient(app)


HEALTH = f"/api/repos/{REPO}/health?branch=main"
FINDINGS = f"/api/repos/{REPO}/health/findings?branch=main"


def test_a_current_copy_gets_304_with_no_body(monkeypatch, state) -> None:
    client = _client(monkeypatch)

    first = client.get(HEALTH)
    assert first.status_code == 200
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "private, no-cache"
    assert first.json()["health_score"] == 81.0

    again = client.get(HEALTH, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag
    assert state["builds"] == 1


def test_finished_bytes_are_reused_by_the_next_reader(monkeypatch, state) -> None:
    client = _client(monkeypatch)

    first = client.get(HEALTH)
    second = client.get(HEALTH)

    assert second.status_code == 200
    assert second.content == first.content
    assert state["builds"] == 1


def test_a_changed_version_gives_a_new_etag_and_a_fresh_build(monkeypatch, state) -> None:
    client = _client(monkeypatch)
    old = client.get(HEALTH).headers["etag"]

    state["version"] = ("v2",)  # say, a finding was marked done
    changed = client.get(HEALTH, headers={"If-None-Match": old})

    assert changed.status_code == 200
    assert changed.headers["etag"] != old
    assert state["builds"] == 2


def test_findings_pages_use_the_same_rules(monkeypatch, state) -> None:
    client = _client(monkeypatch)

    first = client.get(FINDINGS)
    assert first.status_code == 200
    assert first.json() == {"items": [], "total": 0, "limit": 25, "offset": 0}
    again = client.get(FINDINGS, headers={"If-None-Match": first.headers["etag"]})

    assert again.status_code == 304
    assert state["builds"] == 1


def test_a_report_and_a_page_never_share_an_etag(monkeypatch, state) -> None:
    client = _client(monkeypatch)

    assert client.get(HEALTH).headers["etag"] != client.get(FINDINGS).headers["etag"]


def test_access_is_checked_before_any_cache_answer(monkeypatch, state) -> None:
    allowed = _client(monkeypatch)
    etag = allowed.get(HEALTH).headers["etag"]

    denied = _client(monkeypatch, allowed=False)
    response = denied.get(HEALTH, headers={"If-None-Match": etag})

    assert response.status_code == 403
    assert "etag" not in response.headers
