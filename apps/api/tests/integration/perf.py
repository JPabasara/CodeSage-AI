"""A seeded-volume database shared by the performance and capacity checks."""

from __future__ import annotations

import importlib.util
import os
import statistics
import sys
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine, URL

from codesage_api.config import get_settings

from .support import new_session_token

API_ROOT = Path(__file__).resolve().parents[2]

# The large-volume profile is "full"; the default keeps a local run to a few minutes.
SCALES = {
    "full": {"repositories": 20, "snapshots": 30, "files": 500, "findings_per_file": 20},
    "ci": {"repositories": 5, "snapshots": 10, "files": 200, "findings_per_file": 5},
}


def scale() -> dict[str, int]:
    return SCALES[os.environ.get("CODESAGE_PERF_SCALE", "ci")]


def load_seeder() -> Any:
    spec = importlib.util.spec_from_file_location(
        "seed_volume", API_ROOT / "scripts" / "seed_volume.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve their module by name
    spec.loader.exec_module(module)
    return module


@contextmanager
def migrated_database(postgres_url: URL) -> Iterator[Engine]:
    """A fresh database at head, owned like production; yields a superuser engine.

    Module-scoped callers cannot use the function-scoped `database` fixture, so
    this repeats its setup: an owner role, the app role, default grants.
    """
    admin = create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    name = "perf_" + uuid.uuid4().hex
    owner = "perf_owner_" + uuid.uuid4().hex
    password = uuid.uuid4().hex
    with admin.connect() as db:
        if not db.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = 'codesage_app'")):
            db.execute(text("CREATE ROLE codesage_app NOSUPERUSER NOCREATEDB NOCREATEROLE"))
        db.execute(text(f"CREATE ROLE {owner} LOGIN PASSWORD '{password}' NOSUPERUSER"))
        db.execute(text(f"CREATE DATABASE {name} OWNER {owner} TEMPLATE template0"))
    owner_url = postgres_url.set(database=name, username=owner, password=password)
    owner_engine = create_engine(owner_url)
    with owner_engine.begin() as db:
        db.execute(text("GRANT USAGE ON SCHEMA public TO codesage_app"))
        db.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app"
            )
        )
    owner_engine.dispose()
    previous = os.environ.get("CODESAGE_MIGRATION_DATABASE_URL")
    os.environ["CODESAGE_MIGRATION_DATABASE_URL"] = owner_url.render_as_string(hide_password=False)
    get_settings.cache_clear()
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    engine = create_engine(postgres_url.set(database=name), pool_size=10)
    try:
        command.upgrade(config, "head")
        yield engine
    finally:
        if previous is None:
            os.environ.pop("CODESAGE_MIGRATION_DATABASE_URL", None)
        else:
            os.environ["CODESAGE_MIGRATION_DATABASE_URL"] = previous
        get_settings.cache_clear()
        engine.dispose()
        with admin.connect() as db:
            db.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
            db.execute(text(f"DROP OWNED BY {owner}"))
            db.execute(text(f"DROP ROLE {owner}"))
        admin.dispose()


def open_session(engine: Engine, user_id: uuid.UUID, workspace_id: uuid.UUID) -> str:
    """Start a server-side session for a seeded user; returns the cookie value."""
    raw, digest = new_session_token()
    now = datetime.now(UTC)
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO session (id, token_hash, user_id, workspace_id, created_at, "
                "last_used_at, expires_at) VALUES (gen_random_uuid(), :h, :u, :w, :n, :n, :e)"
            ),
            {"h": digest, "u": user_id, "w": workspace_id, "n": now, "e": now + timedelta(hours=2)},
        )
    return raw


@contextmanager
def captured_sql(engine: Engine) -> Iterator[list[tuple[str, Any]]]:
    """Every statement the engine sends, with its driver-level parameters."""
    statements: list[tuple[str, Any]] = []

    def record(_conn, _cursor, statement, parameters, _context, _executemany) -> None:  # noqa: ANN001
        statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def sequential_scans(plan: Any, tables: set[str]) -> list[str]:
    """Relation names of `Seq Scan` nodes over any of `tables` in a JSON plan."""
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("Node Type") == "Seq Scan" and node.get("Relation Name") in tables:
                found.append(node["Relation Name"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(plan)
    return found


def p95_seconds(action: Callable[[], object], runs: int = 20) -> float:
    durations = []
    for _ in range(runs):
        started = time.perf_counter()
        action()
        durations.append(time.perf_counter() - started)
    return statistics.quantiles(durations, n=20, method="inclusive")[18]
