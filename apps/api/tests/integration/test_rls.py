from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from codesage_api.config import get_settings

testcontainers = pytest.importorskip("testcontainers.postgres")
PostgresContainer = testcontainers.PostgresContainer

APP_ROLE = "codesage_rls_test_app"
APP_PASSWORD = "rls-test-password"
API_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def rls_database() -> Iterator[tuple[Engine, Engine, uuid.UUID, uuid.UUID]]:
    """Migrate as owner, seed two tenants, then expose a non-owner app engine."""
    try:
        with PostgresContainer("postgres:16-alpine") as postgres:
            owner_url = make_url(postgres.get_connection_url()).set(
                drivername="postgresql+psycopg"
            )
            owner_engine = create_engine(owner_url, poolclass=NullPool)

            with owner_engine.begin() as connection:
                connection.execute(text(f"CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_PASSWORD}' NOSUPERUSER"))

            old_migration_url = os.environ.get("CODESAGE_MIGRATION_DATABASE_URL")
            os.environ["CODESAGE_MIGRATION_DATABASE_URL"] = owner_url.render_as_string(
                hide_password=False

                
            )
            get_settings.cache_clear()
            try:
                config = Config(str(API_ROOT / "alembic.ini"))
                config.set_main_option("script_location", str(API_ROOT / "alembic"))
                command.upgrade(config, "head")
            finally:
                if old_migration_url is None:
                    os.environ.pop("CODESAGE_MIGRATION_DATABASE_URL", None)
                else:
                    os.environ["CODESAGE_MIGRATION_DATABASE_URL"] = old_migration_url
                get_settings.cache_clear()

            workspace_a = uuid.uuid4()
            workspace_b = uuid.uuid4()
            repository_a = uuid.uuid4()
            repository_b = uuid.uuid4()
            with owner_engine.begin() as connection:
                connection.execute(text(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}"))
                connection.execute(
                    text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}")
                )
                connection.execute(text("INSERT INTO workspace (id) VALUES (:a), (:b)"), {"a": workspace_a, "b": workspace_b})
                connection.execute(
                    text(
                        "INSERT INTO repository "
                        "(id, workspace_id, source_platform, external_repository_id, name, url, visibility, connection_status) "
                        "VALUES (:ra, :wa, 'github', 'repo-a', 'A', 'https://example.test/a', 'public', 'connected'), "
                        "(:rb, :wb, 'github', 'repo-b', 'B', 'https://example.test/b', 'public', 'connected')"
                    ),
                    {"ra": repository_a, "wa": workspace_a, "rb": repository_b, "wb": workspace_b},
                )
                connection.execute(
                    text(
                        "INSERT INTO branch (id, repository_id, name, head_commit_sha, is_default) "
                        "VALUES (:id, :repo, 'main', 'abc123', true)"
                    ),
                    {"id": uuid.uuid4(), "repo": repository_b},
                )

            app_url = make_url(owner_url).set(username=APP_ROLE, password=APP_PASSWORD)
            app_engine = create_engine(app_url, poolclass=NullPool)
            yield owner_engine, app_engine, workspace_a, workspace_b
            app_engine.dispose()
            owner_engine.dispose()
    except Exception as exc:  # noqa: BLE001 - Docker clients raise backend-specific errors
        pytest.skip(f"Docker/PostgreSQL is unavailable: {exc}")


def _set_workspace(connection: object, workspace_id: uuid.UUID) -> None:
    connection.execute(
        text("SELECT set_config('app.current_workspace_id', :workspace_id, true)"),
        {"workspace_id": str(workspace_id)},
    )


def test_app_role_is_not_superuser_or_table_owner(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    owner_engine, app_engine, _, _ = rls_database
    with app_engine.connect() as connection:
        assert connection.execute(text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar_one() is False
    with owner_engine.connect() as connection:
        owner = connection.execute(
            text("SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='repository'")
        ).scalar_one()
    assert owner != APP_ROLE


def test_direct_tenant_rows_are_filtered(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    _, app_engine, workspace_a, _ = rls_database
    with app_engine.begin() as connection:
        _set_workspace(connection, workspace_a)
        assert connection.execute(text("SELECT name FROM repository ORDER BY name")).scalars().all() == ["A"]


def test_descendant_rows_are_filtered_through_parent_chain(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    _, app_engine, workspace_a, _ = rls_database
    with app_engine.begin() as connection:
        _set_workspace(connection, workspace_a)
        assert connection.execute(text("SELECT count(*) FROM branch")).scalar_one() == 0


def test_missing_workspace_context_returns_no_tenant_rows(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    _, app_engine, _, _ = rls_database
    with app_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM repository")).scalar_one() == 0


def test_cross_tenant_insert_is_rejected_by_with_check(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    _, app_engine, workspace_a, workspace_b = rls_database
    with pytest.raises(DBAPIError), app_engine.begin() as connection:
        _set_workspace(connection, workspace_a)
        connection.execute(
            text(
                "INSERT INTO repository "
                "(id, workspace_id, source_platform, external_repository_id, name, url, visibility, connection_status) "
                "VALUES (:id, :workspace, 'github', 'forbidden', 'Forbidden', "
                "'https://example.test/forbidden', 'public', 'connected')"
            ),
            {"id": uuid.uuid4(), "workspace": workspace_b},
        )


def test_cross_tenant_update_cannot_modify_hidden_row(
    rls_database: tuple[Engine, Engine, uuid.UUID, uuid.UUID],
) -> None:
    _, app_engine, workspace_a, workspace_b = rls_database
    with app_engine.begin() as connection:
        _set_workspace(connection, workspace_a)
        result = connection.execute(
            text("UPDATE repository SET name='Compromised' WHERE workspace_id=:other"),
            {"other": workspace_b},
        )
        assert result.rowcount == 0
