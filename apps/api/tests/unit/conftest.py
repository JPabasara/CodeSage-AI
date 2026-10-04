"""Unit tests never open a real database connection.

Some request paths write an audit row on the side: a 403 (`main._audit_denial`),
a failed sign-in (`routers.auth._record_sign_in_failure`). They open their own
session from `SessionLocal`, so a unit test that reaches one of those paths would
connect to whatever `CODESAGE_DATABASE_URL` points at. With nothing listening the
connect can wait for minutes; with a developer's database running it writes rows.

Every module that holds its own reference to `SessionLocal` gets a mock here. A
test that needs a particular fake session still patches its own, and wins,
because a test's monkeypatch runs after this fixture. The audit writes themselves
are covered by the integration suite against a real PostgreSQL.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest

SESSION_FACTORIES = (
    "codesage_api.db.session.SessionLocal",
    "codesage_api.deps.SessionLocal",
    "codesage_api.routers.auth.SessionLocal",
    "codesage_api.routers.members.SessionLocal",
)


@pytest.fixture(autouse=True)
def no_real_database(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for target in SESSION_FACTORIES:
        monkeypatch.setattr(target, MagicMock(name=target))
    yield
