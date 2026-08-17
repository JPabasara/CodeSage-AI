from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, insert
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import codesage_api.db.models  # noqa: F401
from codesage_api.db.base import Base

testcontainers = pytest.importorskip("testcontainers.postgres")
PostgresContainer = testcontainers.PostgresContainer


@pytest.fixture(scope="module")
def postgres_engine() -> Iterator[object]:
    try:
        with PostgresContainer("postgres:16-alpine") as postgres:
            url = make_url(postgres.get_connection_url()).set(drivername="postgresql+psycopg")
            engine = create_engine(url)
            Base.metadata.create_all(engine)
            yield engine
            engine.dispose()
    except Exception as exc: 
        pytest.skip(f"Docker/PostgreSQL is unavailable: {exc}")


def test_duplicate_membership_is_rejected(postgres_engine: object) -> None:
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
            {"id": uuid.uuid4(), "user_id": user_id, "workspace_id": workspace_id, "status": "active"},
        )
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(
                insert(tables["membership"]),
                {"id": uuid.uuid4(), "user_id": user_id, "workspace_id": workspace_id, "status": "active"},
            )
            session.commit()


def test_invalid_bug_risk_probability_is_rejected(postgres_engine: object) -> None:
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
