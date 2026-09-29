"""DBR-31: a logical backup restores data, policies, grants and usable reads."""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

from codesage_api.db.rls import set_workspace_context
from codesage_api.db.repositories import dashboard

from .perf import load_seeder
from .scans import app_session
from .support import table_checksum, table_row_counts
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414

RESULT_TABLES = [
    "analysis_attempt", "snapshot", "source_file", "source_location",
    "static_metric", "finding",
]


def _postgres_cli_url(value: str | URL) -> str:
    """Render a SQLAlchemy URL without its Python driver for PostgreSQL CLI tools."""
    return make_url(value).set(drivername="postgresql").render_as_string(
        hide_password=False
    )


def _cli(name: str) -> str:
    found = shutil.which(name)
    if found is None:
        pytest.skip(f"{name} is required for backup/restore verification")
    return found


def test_dump_restore_preserves_data_security_and_dashboard_reads(
    database, postgres_url, tmp_path: Path
) -> None:
    config, _owner_source, source = database
    command.upgrade(config, "head")
    seeder = load_seeder()
    with source.begin() as db:
        workspaces = seeder.seed(
            db, workspaces=2, repositories=1, snapshots=2,
            files=4, findings_per_file=2, label="backup",
        )
    with source.connect() as db:
        source_counts = table_row_counts(db)
        source_checksums = {table: table_checksum(db, table) for table in RESULT_TABLES}
        source_policies = set(
            db.execute(
                text(
                    "SELECT tablename,policyname,qual,with_check FROM pg_policies "
                    "WHERE schemaname='public'"
                )
            ).tuples()
        )
        source_force = set(
            db.execute(
                text(
                    "SELECT relname,relforcerowsecurity FROM pg_class "
                    "WHERE relnamespace='public'::regnamespace AND relkind='r'"
                )
            ).tuples()
        )

    dump = tmp_path / "codesage.dump"
    subprocess.run(
        [_cli("pg_dump"), "--format=custom", "--no-owner",
         _postgres_cli_url(source.url), "--file", str(dump)],
        check=True,
    )

    restored_name = "restore_" + uuid.uuid4().hex
    admin = create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    restored_url = make_url(postgres_url).set(database=restored_name)
    with admin.connect() as db:
        db.execute(text(f'CREATE DATABASE "{restored_name}" TEMPLATE template0'))
    restored = create_engine(restored_url)
    try:
        subprocess.run(
            [_cli("pg_restore"), "--no-owner", "--exit-on-error",
             "--dbname", _postgres_cli_url(restored_url), str(dump)],
            check=True,
        )
        with restored.connect() as db:
            assert table_row_counts(db) == source_counts
            assert {table: table_checksum(db, table) for table in RESULT_TABLES} == source_checksums
            assert set(
                db.execute(
                    text(
                        "SELECT tablename,policyname,qual,with_check FROM pg_policies "
                        "WHERE schemaname='public'"
                    )
                ).tuples()
            ) == source_policies
            assert set(
                db.execute(
                    text(
                        "SELECT relname,relforcerowsecurity FROM pg_class "
                        "WHERE relnamespace='public'::regnamespace AND relkind='r'"
                    )
                ).tuples()
            ) == source_force
            for table in ("repository", "snapshot", "finding"):
                assert db.scalar(
                    text("SELECT has_table_privilege('codesage_app', :t, 'SELECT')"),
                    {"t": table},
                )

        target = workspaces[0]
        db = app_session(restored)
        set_workspace_context(db, target.workspace_id)
        refs = dashboard.list_completed_snapshot_refs(
            db, target.workspace_id, target.repository_ids[0], "main"
        )
        assert len(refs) == 2
        assert all(ref.analysis_attempt.branch.repository_id == target.repository_ids[0] for ref in refs)
        db.rollback()
        db.close()
    finally:
        restored.dispose()
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE IF EXISTS "{restored_name}" WITH (FORCE)'))
        admin.dispose()
