from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, insert
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import codesage_api.db.models  # noqa: F401
from codesage_api.db.base import Base

testcontainers = pytest.importorskip("testcontainers.postgres")
PostgresContainer = testcontainers.PostgresContainer
API_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = API_ROOT / "src" / "codesage_api" / "authorization" / "policy.json"


def _create_schema(engine: Engine) -> None:
    """Build the metadata schema and seed its catalogue from the RBAC policy."""
    Base.metadata.create_all(engine)
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    tables = Base.metadata.tables
    with engine.begin() as connection:
        connection.execute(
            insert(tables["role"]), [{"id": role_id} for role_id in policy["roles"]]
        )
        connection.execute(
            insert(tables["permission"]),
            [
                {"id": permission_id, "description": description}
                for permission_id, description in policy["permissions"].items()
            ],
        )
        connection.execute(
            insert(tables["role_permission"]),
            [
                {"role_id": role_id, "permission_id": permission_id}
                for role_id, permissions in policy["roles"].items()
                for permission_id in permissions
            ],
        )


@pytest.fixture(scope="module")
def postgres_engine() -> Iterator[Engine]:
    configured_url = os.environ.get("CODESAGE_TEST_POSTGRES_URL")
    if configured_url:
        engine = create_engine(configured_url)
        try:
            _create_schema(engine)
            yield engine
        finally:
            engine.dispose()
        return

    postgres_started = False
    try:
        with PostgresContainer("postgres:16-alpine") as postgres:
            postgres_started = True
            url = make_url(postgres.get_connection_url()).set(drivername="postgresql+psycopg")
            engine = create_engine(url)
            _create_schema(engine)
            yield engine
            engine.dispose()
    except Exception as exc:
        if postgres_started or os.environ.get("CI") == "true":
            raise
        pytest.skip(f"Docker/PostgreSQL is unavailable: {exc}")


def test_duplicate_membership_is_rejected(postgres_engine: Engine) -> None:
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    tables = Base.metadata.tables

    with Session(postgres_engine) as session:
        session.execute(insert(tables["workspace"]), {"id": workspace_id})
        session.execute(
            insert(tables["app_user"]),
            {
                "id": user_id,
                "asgardeo_sub": f"asgardeo-{user_id}",
                "github_user_id": f"github-{user_id}",
                "github_username": "database-test-user",
                "theme_preference": "system",
            },
        )
        session.execute(
            insert(tables["membership"]),
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "workspace_id": workspace_id,
                "status": "active",
            },
        )
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(
                insert(tables["membership"]),
                {
                    "id": uuid.uuid4(),
                    "user_id": user_id,
                    "workspace_id": workspace_id,
                    "status": "active",
                },
            )
            session.commit()


def test_invalid_bug_risk_probability_is_rejected(postgres_engine: Engine) -> None:
    """Exercise the actual PostgreSQL CHECK, not only its ORM declaration."""
    table = Base.metadata.tables["bug_risk_prediction"]

    with Session(postgres_engine) as session, pytest.raises(IntegrityError):
        session.execute(
            insert(table),
            {
                "id": uuid.uuid4(),
                "source_file_id": uuid.uuid4(),
                "model_version_id": uuid.uuid4(),
                "risk_score": 1.5,
                "confidence": 0.8,
            },
        )
        session.commit()
