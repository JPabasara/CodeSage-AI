import pytest
from sqlalchemy import text, select
from sqlalchemy.orm import Session
from .test_query_performance import volume  # noqa
from .test_rbac_migration import postgres_url  # noqa

pytestmark = pytest.mark.perf

def test_debug(volume):
    engine, ws = volume
    from .scans import app_session
    from codesage_api.services import dashboard, profiles
    from codesage_api.db.rls import set_workspace_context
    from codesage_api.db.repositories import dashboard as repo_q
    db = app_session(engine)
    set_workspace_context(db, ws.workspace_id)
    repo = ws.repository_ids[0]
    refs = repo_q.list_completed_snapshot_refs(db, ws.workspace_id, repo, "main")
    print("REFS", len(refs))
    profile = profiles.resolve_effective(db, ws.workspace_id, repo)
    cached, created = dashboard.prepare_snapshot_score(db, refs[0], profile)
    dashboard.calculate_snapshot_score(db, ws.workspace_id, cached, profile)
    print("OK", cached.health_score)
