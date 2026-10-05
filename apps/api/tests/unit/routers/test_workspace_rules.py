from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.orm import Session

from codesage_api import deps
from codesage_api.authorization.context import AuthorizationContext
from codesage_api.deps import (
    get_authorization_context,
    get_current_user_id,
    get_db,
    get_workspace_id,
)
from codesage_api.main import create_app
from codesage_api.schemas.rules import WorkspaceRulesOut
from codesage_api.services import workspace_rules


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["org-admin", "manager", "developer", "viewer"])
async def test_rules_readable_by_all_but_only_admin_can_save(role, monkeypatch):
    app = create_app()
    db = MagicMock(spec=Session)
    workspace_id = uuid.uuid4()
    policy = json.loads(
        (Path(__file__).parents[3] / "src/codesage_api/authorization/policy.json").read_text()
    )
    monkeypatch.setattr(deps, "SessionLocal", lambda: db)
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_workspace_id] = lambda: workspace_id
    app.dependency_overrides[get_authorization_context] = lambda: AuthorizationContext(
        user_id=uuid.uuid4(),
        workspace_id=workspace_id,
        membership_id=uuid.uuid4(),
        role_id=role,
        permissions=frozenset(policy["roles"][role]),
    )
    output = WorkspaceRulesOut(rules=[], disabled_rule_ids=[])
    read = MagicMock(return_value=output)
    write = MagicMock(return_value=output)
    comments_write = MagicMock(return_value=output)
    monkeypatch.setattr(workspace_rules, "get", read)
    monkeypatch.setattr(workspace_rules, "update", write)
    monkeypatch.setattr(workspace_rules, "update_comments", comments_write)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/profiles/rules")).status_code == 200
        response = await client.put("/api/profiles/rules", json={"disabled_rule_ids": []})
        comments_response = await client.patch("/api/profiles/rules", json={"comment_rules": []})
        tested = await client.post("/api/profiles/rules/test-comment", json={"match_type": "keyword", "pattern": "TODO", "sample_comment": "// TODO: fix"})
        assert tested.status_code == 200
        assert tested.json() == {"matched": True}
    read.assert_called_once_with(db, workspace_id)
    if role == "org-admin":
        assert response.status_code == 200
        write.assert_called_once_with(db, workspace_id, [])
        assert comments_response.status_code == 200
        comments_write.assert_called_once_with(db, workspace_id, [])
    else:
        assert response.status_code == 403
        write.assert_not_called()
        assert comments_response.status_code == 403
        comments_write.assert_not_called()
