from __future__ import annotations

import uuid
from collections.abc import Iterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codesage_api.deps import get_current_user_id, get_db, get_workspace_id
from codesage_api.main import create_app
from codesage_api.schemas import CategoryWeights, ScoreProfileOut
from codesage_api.services import profiles


def _profile(name: str = "Balanced") -> ScoreProfileOut:
    return ScoreProfileOut(
        id=str(uuid.uuid4()),
        name=name,
        weights=CategoryWeights(
            security=1.0,
            code_design=1.0,
            requirement=1.0,
            documentation=1.0,
            test=1.0,
        ),
        trust_s=0.5,
        is_preset=name != "Custom",
        is_active=True,
    )


def _client() -> tuple[TestClient, MagicMock, uuid.UUID, uuid.UUID]:
    app = create_app()
    db = MagicMock(spec=Session)
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    def database() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_current_user_id] = lambda: user_id
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_db] = database
    return TestClient(app), db, workspace_id, user_id


def test_profile_reads_pass_workspace_context(monkeypatch) -> None:
    client, db, workspace_id, _ = _client()
    active = _profile()

    def list_available(session: Session, workspace: uuid.UUID) -> list[ScoreProfileOut]:
        assert session is db
        assert workspace == workspace_id
        return [active]

    def get_active_output(session: Session, workspace: uuid.UUID) -> ScoreProfileOut:
        assert session is db
        assert workspace == workspace_id
        return active

    monkeypatch.setattr(profiles, "list_available", list_available)
    monkeypatch.setattr(profiles, "get_active_output", get_active_output)

    with client:
        listed = client.get("/api/profiles")
        current = client.get("/api/profiles/active")

    assert listed.status_code == 200
    assert current.status_code == 200
    assert listed.json()[0]["name"] == "Balanced"
    assert current.json()["name"] == "Balanced"


def test_apply_profile_passes_complete_authenticated_context(monkeypatch) -> None:
    client, db, workspace_id, user_id = _client()
    expected = _profile("Custom")

    def apply(
        session: Session,
        workspace: uuid.UUID,
        weights: dict[str, float],
        trust_s: float,
        actor: uuid.UUID,
        name: str | None,
    ) -> ScoreProfileOut:
        assert session is db
        assert workspace == workspace_id
        assert actor == user_id
        assert name is None
        assert weights["security"] == 9.0
        assert trust_s == 5.0
        return expected

    monkeypatch.setattr(profiles, "apply", apply)
    with client:
        response = client.put(
            "/api/profiles/active",
            json={
                "weights": {
                    "security": 9.0,
                    "code_design": 1.0,
                    "requirement": 1.0,
                    "documentation": 1.0,
                    "test": 1.0,
                },
                "trust_s": 5.0,
            },
        )

    assert response.status_code == 200
    assert response.json()["name"] == "Custom"
