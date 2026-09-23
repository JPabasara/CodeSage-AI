"""Real PostgreSQL checks for the RBAC migration, including legacy upgrades.

Set CODESAGE_TEST_POSTGRES_URL to a disposable PostgreSQL superuser connection
or let testcontainers start PostgreSQL. Each test creates its own database.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError

from codesage_api.config import get_settings

API_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS = "20260920_0009"
REVISION = "20260921_0010"


@pytest.fixture(scope="module")
def postgres_url():
    explicit = os.environ.get("CODESAGE_TEST_POSTGRES_URL")
    if explicit:
        yield make_url(explicit)
        return
    postgres = pytest.importorskip("testcontainers.postgres").PostgresContainer(
        "postgres:16-alpine"
    )
    try:
        postgres.start()
    except Exception as exc:
        if os.environ.get("CI") == "true":
            raise
        pytest.skip(f"Docker/PostgreSQL is unavailable: {exc}")
    try:
        yield make_url(postgres.get_connection_url()).set(drivername="postgresql+psycopg")
    finally:
        postgres.stop()


@pytest.fixture
def database(postgres_url, monkeypatch):
    admin = create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    name = "rbac_test_" + uuid.uuid4().hex
    owner = "rbac_owner_" + uuid.uuid4().hex
    password = uuid.uuid4().hex
    with admin.connect() as db:
        if not db.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = 'codesage_app'")):
            db.execute(text("CREATE ROLE codesage_app NOSUPERUSER NOCREATEDB NOCREATEROLE"))
        db.execute(text(f"CREATE ROLE {owner} LOGIN PASSWORD '{password}' NOSUPERUSER"))
        db.execute(text(f"CREATE DATABASE {name} OWNER {owner} ENCODING 'UTF8' TEMPLATE template0"))
    owner_url = postgres_url.set(database=name, username=owner, password=password)
    engine = create_engine(owner_url)
    super_engine = create_engine(postgres_url.set(database=name))
    with engine.begin() as db:
        db.execute(text("GRANT USAGE ON SCHEMA public TO codesage_app"))
        db.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app"
            )
        )
    monkeypatch.setenv(
        "CODESAGE_MIGRATION_DATABASE_URL", owner_url.render_as_string(hide_password=False)
    )
    get_settings.cache_clear()
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    try:
        yield config, engine, super_engine
    finally:
        get_settings.cache_clear()
        engine.dispose()
        super_engine.dispose()
        with admin.connect() as db:
            db.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
            db.execute(text(f"DROP ROLE {owner}"))
        admin.dispose()


def seed_member(engine, status="active", workspace=None):
    workspace = workspace or uuid.uuid4()
    user = uuid.uuid4()
    membership = uuid.uuid4()
    with engine.begin() as db:
        db.execute(
            text("INSERT INTO workspace (id) VALUES (:id) ON CONFLICT DO NOTHING"),
            {"id": workspace},
        )
        db.execute(
            text(
                "INSERT INTO app_user (id, asgardeo_sub, theme_preference) "
                "VALUES (:id, :sub, 'system')"
            ),
            {"id": user, "sub": str(user)},
        )
        db.execute(
            text(
                "INSERT INTO membership (id, user_id, workspace_id, status) "
                "VALUES (:id, :user, :workspace, :status)"
            ),
            {"id": membership, "user": user, "workspace": workspace, "status": status},
        )
    return membership, workspace


def assert_policy(engine):
    policy = json.loads((API_ROOT / "src/codesage_api/authorization/policy.json").read_text())
    with engine.connect() as db:
        assert set(db.scalars(text('SELECT id FROM "role"'))) == set(policy["roles"])
        assert (
            dict(db.execute(text("SELECT id, description FROM permission")).tuples().all())
            == policy["permissions"]
        )
        assert set(
            db.execute(text("SELECT role_id, permission_id FROM role_permission")).tuples()
        ) == {
            (role, permission)
            for role, permissions in policy["roles"].items()
            for permission in permissions
        }


def test_fresh_install_policy_privileges_and_default(database):
    config, engine, super_engine = database
    command.upgrade(config, "head")
    assert_policy(engine)
    membership, _ = seed_member(super_engine)
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT role_id FROM membership WHERE id = :id"), {"id": membership})
            == "viewer"
        )
        for table in ("role", "permission", "role_permission"):
            assert db.scalar(
                text("SELECT has_table_privilege('codesage_app', :table, 'SELECT')"),
                {"table": table},
            )
            for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                assert not db.scalar(
                    text("SELECT has_table_privilege('codesage_app', :table, :privilege)"),
                    {"table": table, "privilege": privilege},
                )
    with super_engine.begin() as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        assert db.scalar(text('SELECT count(*) FROM "role"')) == 4
    with pytest.raises(DBAPIError), super_engine.begin() as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        db.execute(text("DELETE FROM role_permission"))
    with pytest.raises(IntegrityError), engine.begin() as db:
        db.execute(
            text("UPDATE membership SET role_id = 'unknown' WHERE id = :id"), {"id": membership}
        )
    with pytest.raises(IntegrityError), engine.begin() as db:
        db.execute(text("UPDATE membership SET role_id = NULL WHERE id = :id"), {"id": membership})


def test_upgrade_backfills_only_active_members_and_preserves_rls(database):
    config, engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    first, workspace = seed_member(super_engine)
    second, _ = seed_member(super_engine)
    invited, _ = seed_member(super_engine, "invited", workspace)
    inactive, _ = seed_member(super_engine, "inactive", workspace)
    command.upgrade(config, "head")
    assert_policy(engine)
    with engine.connect() as db:
        assert dict(db.execute(text("SELECT id, role_id FROM membership")).tuples().all()) == {
            first: "org-admin",
            second: "org-admin",
            invited: "viewer",
            inactive: "viewer",
        }
    with super_engine.begin() as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        assert db.scalar(text("SELECT count(*) FROM membership")) == 0
        db.execute(
            text("SELECT set_config('app.current_workspace_id', :id, true)"), {"id": str(workspace)}
        )
        assert set(db.scalars(text("SELECT id FROM membership"))) == {first, invited, inactive}


def test_ambiguous_active_members_abort_without_partial_schema(database):
    config, engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    _, workspace = seed_member(super_engine)
    seed_member(super_engine, workspace=workspace)
    with pytest.raises(DBAPIError, match="multiple active members"):
        command.upgrade(config, REVISION)
    assert "role" not in inspect(engine).get_table_names()
    assert "role_id" not in {col["name"] for col in inspect(engine).get_columns("membership")}
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PREVIOUS


def test_downgrade_and_reupgrade_preserve_memberships(database):
    config, engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    membership, _ = seed_member(super_engine)
    command.upgrade(config, REVISION)
    command.downgrade(config, PREVIOUS)
    assert "role" not in inspect(engine).get_table_names()
    assert "role_id" not in {col["name"] for col in inspect(engine).get_columns("membership")}
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM membership WHERE id = :id"), {"id": membership})
            == 1
        )
    command.upgrade(config, REVISION)
    assert_policy(engine)


def test_new_workspace_creator_is_admin_using_application_role(database):
    from sqlalchemy.orm import Session

    from codesage_api.db.models import Membership
    from codesage_api.services.auth import (
        IdentityClaims,
        create_workspace,
        establish_session,
    )

    config, _, super_engine = database
    command.upgrade(config, "head")
    claims = IdentityClaims(
        sub=str(uuid.uuid4()),
        email="creator@example.test",
        name="Workspace creator",
        picture=None,
        identity_provider="github",
    )
    with Session(super_engine) as session:
        session.execute(text("SET LOCAL ROLE codesage_app"))
        record = establish_session(session, claims)
        # Sign-in provisions the person only; the workspace is the user's own
        # first act, and org-admin is assigned by creating it.
        assert record.workspace_id is None
        created = create_workspace(
            session, session_id=record.id, user_id=record.user_id, name="Acme"
        )
        assert created is not None
        from sqlalchemy import select

        membership = session.scalar(
            select(Membership).where(
                Membership.user_id == record.user_id,
                Membership.workspace_id == created.workspace_id,
            )
        )
        assert membership is not None
        assert membership.role_id == "org-admin"
        session.commit()
