from __future__ import annotations

import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from codesage_api.tasks import score_cache


def test_score_worker_sets_tenant_context_before_reading_cache(monkeypatch) -> None:
    workspace_id = uuid.uuid4()
    session = MagicMock(spec=Session)
    tenant_is_bound = False

    def bind_tenant(_session: Session, requested_workspace: uuid.UUID) -> None:
        nonlocal tenant_is_bound
        assert _session is session
        assert requested_workspace == workspace_id
        tenant_is_bound = True

    def tenant_filtered_get(_model, _cache_id):
        assert tenant_is_bound, "worker queried before applying tenant RLS context"
        # This is how PostgreSQL/RLS presents a cache owned by another tenant.

    @contextmanager
    def scoped_session():
        yield session

    session.get.side_effect = tenant_filtered_get
    monkeypatch.setattr(score_cache, "set_workspace_context", bind_tenant)
    monkeypatch.setattr(score_cache, "session_scope", scoped_session)
    calculate = MagicMock()
    monkeypatch.setattr(score_cache.dashboard, "calculate_snapshot_score", calculate)

    score_cache.score_snapshot.run(
        str(uuid.uuid4()),
        str(workspace_id),
        {"weights": {}, "trust": 0.5, "name": "Balanced"},
    )

    assert tenant_is_bound is True
    calculate.assert_not_called()
