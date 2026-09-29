"""Existing accounts must not be surprised by first-run onboarding after deploy."""

from __future__ import annotations

import uuid

from alembic import command
from sqlalchemy import text

from .test_rbac_migration import database as database  # noqa: PLC0414 -- fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- fixture


def test_existing_users_are_complete_and_future_users_start_pending(database):
    config, owner_engine, _super_engine = database
    command.upgrade(config, "20260925_0018")

    existing_id = uuid.uuid4()
    with owner_engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO app_user (id, asgardeo_sub, theme_preference) "
                "VALUES (:id, :sub, 'system')"
            ),
            {"id": existing_id, "sub": str(existing_id)},
        )

    command.upgrade(config, "head")

    future_id = uuid.uuid4()
    with owner_engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO app_user (id, asgardeo_sub, theme_preference) "
                "VALUES (:id, :sub, 'system')"
            ),
            {"id": future_id, "sub": str(future_id)},
        )
        assert (
            db.scalar(
                text("SELECT product_tour_completed_at FROM app_user WHERE id = :id"),
                {"id": existing_id},
            )
            is not None
        )
        assert (
            db.scalar(
                text("SELECT product_tour_completed_at FROM app_user WHERE id = :id"),
                {"id": future_id},
            )
            is None
        )
