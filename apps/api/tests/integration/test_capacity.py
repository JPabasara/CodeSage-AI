"""Baseline capacity and RLS isolation at 50 workspaces."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import text

from codesage_api.db.rls import set_workspace_context

from .perf import load_seeder, migrated_database
from .scans import app_session
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414

pytestmark = pytest.mark.perf


@pytest.fixture(scope="module")
def capacity(postgres_url) -> Iterator[tuple]:
    with migrated_database(postgres_url) as engine:
        with engine.begin() as db:
            workspaces = load_seeder().seed(
                db, workspaces=50, repositories=2, snapshots=2,
                files=10, findings_per_file=2, label="capacity",
            )
        yield engine, workspaces


def test_fifty_workspaces_remain_isolated_and_size_is_recorded(capacity) -> None:
    engine, workspaces = capacity
    assert len(workspaces) == 50
    for item in workspaces[::10]:  # deterministic sample of five
        db = app_session(engine)
        set_workspace_context(db, item.workspace_id)
        visible_workspaces = set(db.scalars(text("SELECT id FROM workspace")))
        visible_repositories = set(db.scalars(text("SELECT id FROM repository")))
        visible_users = set(
            db.scalars(
                text(
                    "SELECT m.user_id FROM membership m "
                    "WHERE m.workspace_id=:workspace"
                ),
                {"workspace": item.workspace_id},
            )
        )
        assert visible_workspaces == {item.workspace_id}
        assert visible_repositories == set(item.repository_ids)
        assert visible_users == {item.user_id}
        db.rollback()
        db.close()
    with engine.connect() as db:
        size = db.scalar(text("SELECT pg_database_size(current_database())"))
        active = db.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"))
    print(f"50-workspace database size: {size} bytes; active connections: {active}")
    assert size > 0
    assert active <= engine.pool.size() + engine.pool.checkedin() + 5
