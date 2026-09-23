"""Revision 0017 applied to a database that already has real rows in it.

The onboarding tests next door build every database from `head`, which proves
the end state is right but says nothing about the journey. This module starts at
0016 — the shape production is in — puts sessions, memberships and workspaces
there, and then upgrades.

Two of 0017's changes can only go wrong on existing data: dropping `NOT NULL`
from `session.workspace_id` (which must not disturb the sessions already
pointing at a workspace) and replacing `app_workspace_for_user()`, whose whole
purpose is to pick among memberships that already exist. The new ordering —
most recently used first — is unobservable on an empty database.

Reads use the superuser engine deliberately: `session` and `membership` are
behind row-level security, and these assertions are about what the migration
wrote, not about what a tenant may see.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import text

from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

PREVIOUS = "20260923_0016"
REVISION = "20260923_0017"

NOW = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)


def seed_user(engine, *, sub: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO app_user (id, asgardeo_sub, email, email_verified,"
                " theme_preference)"
                " VALUES (:id, :sub, :email, true, 'system')"
            ),
            {"id": user_id, "sub": sub, "email": f"{sub}@example.test"},
        )
    return user_id


def seed_workspace(engine, *, name: str) -> uuid.UUID:
    workspace_id = uuid.uuid4()
    with engine.begin() as db:
        db.execute(
            text("INSERT INTO workspace (id, name) VALUES (:id, :name)"),
            {"id": workspace_id, "name": name},
        )
    return workspace_id


def seed_membership(engine, *, user_id, workspace_id, role="org-admin", status="active") -> None:
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO membership (id, user_id, workspace_id, role_id, status)"
                " VALUES (:id, :user, :ws, :role, :status)"
            ),
            {
                "id": uuid.uuid4(),
                "user": user_id,
                "ws": workspace_id,
                "role": role,
                "status": status,
            },
        )


def seed_session(engine, *, user_id, workspace_id, last_used: datetime) -> uuid.UUID:
    session_id = uuid.uuid4()
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO session (id, user_id, workspace_id, created_at,"
                " last_used_at, expires_at)"
                " VALUES (:id, :user, :ws, :created, :used, :expires)"
            ),
            {
                "id": session_id,
                "user": user_id,
                "ws": workspace_id,
                "created": last_used,
                "used": last_used,
                "expires": last_used + timedelta(days=7),
            },
        )
    return session_id


def workspace_for(engine, user_id) -> uuid.UUID | None:
    with engine.begin() as db:
        return db.execute(
            text("SELECT app_workspace_for_user(:user)"), {"user": user_id}
        ).scalar_one_or_none()


def column(engine, table: str, name: str):
    with engine.begin() as db:
        return db.execute(
            text(
                "SELECT is_nullable, column_default FROM information_schema.columns"
                " WHERE table_name = :table AND column_name = :name"
            ),
            {"table": table, "name": name},
        ).one_or_none()


# ── schema ──────────────────────────────────────────────────────────────────


def test_existing_sessions_keep_their_workspace_when_the_column_relaxes(database):
    """Dropping NOT NULL must not be mistaken for clearing the column."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    user_id = seed_user(super_engine, sub="returning")
    workspace_id = seed_workspace(super_engine, name="Acme")
    seed_membership(super_engine, user_id=user_id, workspace_id=workspace_id)
    session_id = seed_session(
        super_engine, user_id=user_id, workspace_id=workspace_id, last_used=NOW
    )

    assert column(super_engine, "session", "workspace_id").is_nullable == "NO"

    command.upgrade(config, "head")

    assert column(super_engine, "session", "workspace_id").is_nullable == "YES"
    with super_engine.begin() as db:
        kept = db.execute(
            text("SELECT workspace_id FROM session WHERE id = :id"), {"id": session_id}
        ).scalar_one()
    assert kept == workspace_id


def test_existing_workspaces_receive_timestamps_rather_than_nulls(database):
    """The new NOT NULL columns are backfilled, so no row is left unreadable."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id = seed_workspace(super_engine, name="Acme")

    command.upgrade(config, "head")

    with super_engine.begin() as db:
        row = db.execute(
            text(
                "SELECT name, description, website_url, created_at, updated_at"
                " FROM workspace WHERE id = :id"
            ),
            {"id": workspace_id},
        ).one()
    assert row.name == "Acme"
    # Not previously recorded anywhere, so absent rather than invented.
    assert row.description is None
    assert row.website_url is None
    # Present, because the application reads them unconditionally.
    assert row.created_at is not None
    assert row.updated_at is not None


# ── app_workspace_for_user ──────────────────────────────────────────────────


def test_sign_in_returns_the_workspace_the_user_was_last_in(database):
    """The point of the new ordering, and invisible on an empty database."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    user_id = seed_user(super_engine, sub="two-workspaces")
    first = seed_workspace(super_engine, name="First")
    second = seed_workspace(super_engine, name="Second")
    seed_membership(super_engine, user_id=user_id, workspace_id=first)
    seed_membership(super_engine, user_id=user_id, workspace_id=second)
    seed_session(
        super_engine, user_id=user_id, workspace_id=first, last_used=NOW - timedelta(days=3)
    )
    seed_session(super_engine, user_id=user_id, workspace_id=second, last_used=NOW)

    command.upgrade(config, "head")

    assert workspace_for(super_engine, user_id) == second


def test_a_user_who_has_never_signed_in_still_gets_the_same_answer_every_time(database):
    """No sessions means no recency to order by; workspace ID breaks the tie."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    user_id = seed_user(super_engine, sub="invited-only")
    left = seed_workspace(super_engine, name="Left")
    right = seed_workspace(super_engine, name="Right")
    seed_membership(super_engine, user_id=user_id, workspace_id=left)
    seed_membership(super_engine, user_id=user_id, workspace_id=right)

    command.upgrade(config, "head")

    expected = min(left, right, key=str)
    assert workspace_for(super_engine, user_id) == expected
    assert workspace_for(super_engine, user_id) == expected


def test_another_users_activity_does_not_choose_this_users_workspace(database):
    """The recency subquery is scoped to the user being looked up, not the row."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    user_id = seed_user(super_engine, sub="quiet")
    other_id = seed_user(super_engine, sub="busy")
    first = seed_workspace(super_engine, name="First")
    second = seed_workspace(super_engine, name="Second")
    for workspace_id in (first, second):
        seed_membership(super_engine, user_id=user_id, workspace_id=workspace_id)
        seed_membership(super_engine, user_id=other_id, workspace_id=workspace_id)
    # The other user lives in `second`. Our user has never used either.
    seed_session(super_engine, user_id=other_id, workspace_id=second, last_used=NOW)

    command.upgrade(config, "head")

    assert workspace_for(super_engine, user_id) == min(first, second, key=str)


def test_a_revoked_membership_leaves_the_user_with_no_workspace(database):
    """Onboarding, not an error: sign-in now legitimately resolves to NULL."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    user_id = seed_user(super_engine, sub="removed")
    workspace_id = seed_workspace(super_engine, name="Acme")
    seed_membership(super_engine, user_id=user_id, workspace_id=workspace_id, status="inactive")

    command.upgrade(config, "head")

    assert workspace_for(super_engine, user_id) is None


# ── downgrade ───────────────────────────────────────────────────────────────


def test_downgrade_restores_the_old_shape_and_drops_only_unrepresentable_sessions(database):
    """A workspace-less session cannot exist under 0016, so it goes; others stay."""
    config, _engine, super_engine = database
    command.upgrade(config, "head")
    user_id = seed_user(super_engine, sub="mixed")
    workspace_id = seed_workspace(super_engine, name="Acme")
    seed_membership(super_engine, user_id=user_id, workspace_id=workspace_id)
    bound = seed_session(super_engine, user_id=user_id, workspace_id=workspace_id, last_used=NOW)
    onboarding = seed_session(super_engine, user_id=user_id, workspace_id=None, last_used=NOW)

    command.downgrade(config, PREVIOUS)

    with super_engine.begin() as db:
        remaining = set(db.execute(text("SELECT id FROM session")).scalars())
    assert bound in remaining
    assert onboarding not in remaining
    assert column(super_engine, "session", "workspace_id").is_nullable == "NO"
    assert column(super_engine, "workspace", "description") is None


@pytest.mark.parametrize("target", [PREVIOUS, "head"])
def test_the_migration_is_reversible(database, target):
    """Down and back up again, with data present the whole time."""
    config, _engine, super_engine = database
    command.upgrade(config, "head")
    user_id = seed_user(super_engine, sub="round-trip")
    workspace_id = seed_workspace(super_engine, name="Acme")
    seed_membership(super_engine, user_id=user_id, workspace_id=workspace_id)
    seed_session(super_engine, user_id=user_id, workspace_id=workspace_id, last_used=NOW)

    command.downgrade(config, PREVIOUS)
    command.upgrade(config, target)

    assert workspace_for(super_engine, user_id) == workspace_id
