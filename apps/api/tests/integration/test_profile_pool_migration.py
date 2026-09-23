"""Real PostgreSQL checks for the workspace profile pool (revision 0015).

Set CODESAGE_TEST_POSTGRES_URL to a disposable PostgreSQL superuser connection
or let testcontainers start PostgreSQL. Each test creates its own database.

The invariants here are the ones a service is not trusted to remember: exactly
three immutable built-ins per workspace, at most five custom profiles even under
concurrent creation, one override per project, no reference across workspaces,
and no deletion of a profile that is still in use.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from .test_rbac_migration import database as database  # noqa: PLC0414 -- pytest fixture
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414 -- pytest fixture

PREVIOUS = "20260921_0014"
REVISION = "20260923_0015"

BALANCED = (1.0, 1.0, 1.0, 1.0, 1.0, 0.5)
SECURITY_FIRST = (3.0, 1.0, 0.8, 0.5, 1.0, 0.5)
CUSTOM = (2.5, 0.4, 1.1, 0.9, 1.3, 0.25)


def seed_legacy_workspace(engine, *, profile=None, repository=False):
    """One workspace as revision 0014 left it: at most one active profile row."""
    workspace_id = uuid.uuid4()
    profile_id = uuid.uuid4() if profile is not None else None
    repository_id = uuid.uuid4() if repository else None
    with engine.begin() as db:
        db.execute(
            text("INSERT INTO workspace (id, name) VALUES (:id, 'Legacy')"),
            {"id": workspace_id},
        )
        if profile is not None:
            name, (security, code_design, requirement, documentation, test, trust) = profile
            db.execute(
                text(
                    "INSERT INTO scoring_profile ("
                    "  id, workspace_id, name, security_weight, code_design_weight,"
                    "  requirement_weight, documentation_weight, test_weight,"
                    "  trust_slider, is_active"
                    ") VALUES (:id, :ws, :name, :sec, :cd, :req, :doc, :test, :trust, true)"
                ),
                {
                    "id": profile_id,
                    "ws": workspace_id,
                    "name": name,
                    "sec": security,
                    "cd": code_design,
                    "req": requirement,
                    "doc": documentation,
                    "test": test,
                    "trust": trust,
                },
            )
        if repository:
            db.execute(
                text(
                    "INSERT INTO repository ("
                    "  id, workspace_id, source_platform, external_repository_id,"
                    "  name, owner, url, visibility, connection_status"
                    ") VALUES (:id, :ws, 'github', :external, 'app', 'acme',"
                    "  'https://example.test/app', 'public', 'connected')"
                ),
                {"id": repository_id, "ws": workspace_id, "external": str(repository_id)},
            )
    return workspace_id, profile_id, repository_id


def pool(db_engine, workspace_id):
    """Every profile in one workspace, keyed by id.

    Read through the superuser connection on purpose. scoring_profile and both
    new tables carry FORCE ROW LEVEL SECURITY, which applies the tenant policy to
    the table owner as well, so an owner connection with no bound workspace would
    read back an empty pool and every assertion here would pass vacuously.
    """
    with db_engine.connect() as db:
        rows = db.execute(
            text(
                "SELECT id, kind, preset_key, name, security_weight, trust_slider "
                "FROM scoring_profile WHERE workspace_id = :ws"
            ),
            {"ws": workspace_id},
        ).all()
    return {row.id: row for row in rows}


def default_profile_id(db_engine, workspace_id):
    with db_engine.connect() as db:
        return db.scalar(
            text(
                "SELECT default_scoring_profile_id FROM workspace_profile_settings "
                "WHERE workspace_id = :ws"
            ),
            {"ws": workspace_id},
        )


def insert_custom(db, workspace_id, name, *, profile_id=None):
    profile_id = profile_id or uuid.uuid4()
    db.execute(
        text(
            "INSERT INTO scoring_profile ("
            "  id, workspace_id, kind, name, security_weight, code_design_weight,"
            "  requirement_weight, documentation_weight, test_weight, trust_slider"
            ") VALUES (:id, :ws, 'custom', :name, 1, 1, 1, 1, 1, 0.5)"
        ),
        {"id": profile_id, "ws": workspace_id, "name": name},
    )
    return profile_id


def as_app(db, workspace_id):
    """Speak as the application role, bound to one workspace, as the API does."""
    db.execute(text("SET LOCAL ROLE codesage_app"))
    db.execute(
        text("SELECT set_config('app.current_workspace_id', :ws, true)"),
        {"ws": str(workspace_id)},
    )


# ── migration ───────────────────────────────────────────────────────────────


def test_workspace_without_a_profile_is_seeded_with_built_ins_and_balanced(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, _, _ = seed_legacy_workspace(super_engine)

    command.upgrade(config, "head")

    rows = pool(super_engine, workspace_id)
    assert len(rows) == 3
    assert all(row.kind == "built_in" for row in rows.values())
    assert {row.preset_key for row in rows.values()} == {
        "balanced",
        "security_first",
        "delivery_speed",
    }
    default = rows[default_profile_id(super_engine, workspace_id)]
    assert default.preset_key == "balanced"


def test_preset_equivalent_active_row_becomes_that_built_in(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, profile_id, _ = seed_legacy_workspace(
        super_engine, profile=("Security-first", SECURITY_FIRST)
    )

    command.upgrade(config, "head")

    rows = pool(super_engine, workspace_id)
    assert len(rows) == 3
    promoted = rows[profile_id]
    assert promoted.kind == "built_in"
    assert promoted.preset_key == "security_first"
    # The id is preserved, so nothing that referenced it sees a new profile.
    assert default_profile_id(super_engine, workspace_id) == profile_id


def test_custom_active_row_stays_custom_and_stays_the_default(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, profile_id, _ = seed_legacy_workspace(
        super_engine, profile=("Our tuning", CUSTOM)
    )

    command.upgrade(config, "head")

    rows = pool(super_engine, workspace_id)
    assert len(rows) == 4
    migrated = rows[profile_id]
    assert migrated.kind == "custom"
    assert migrated.preset_key is None
    assert migrated.name == "Our tuning"
    assert migrated.security_weight == pytest.approx(CUSTOM[0])
    assert migrated.trust_slider == pytest.approx(CUSTOM[5])
    assert default_profile_id(super_engine, workspace_id) == profile_id


def test_a_custom_row_named_after_a_preset_is_renamed_not_dropped(database):
    """The normalized name rule must not cost a team the profile it authored."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, profile_id, _ = seed_legacy_workspace(
        super_engine, profile=("balanced", CUSTOM)
    )

    command.upgrade(config, "head")

    rows = pool(super_engine, workspace_id)
    assert len(rows) == 4
    renamed = rows[profile_id]
    assert renamed.kind == "custom"
    assert renamed.name.startswith("balanced (")
    assert renamed.security_weight == pytest.approx(CUSTOM[0])
    assert default_profile_id(super_engine, workspace_id) == profile_id
    built_in_names = {row.name for row in rows.values() if row.kind == "built_in"}
    assert "Balanced" in built_in_names


def test_existing_projects_inherit_the_migrated_default(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, profile_id, repository_id = seed_legacy_workspace(
        super_engine, profile=("Our tuning", CUSTOM), repository=True
    )

    command.upgrade(config, "head")

    with super_engine.connect() as db:
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM repository_profile_assignment "
                    "WHERE repository_id = :repo"
                ),
                {"repo": repository_id},
            )
            == 0
        )
    # No override, so the project scores with exactly the numbers it had before.
    assert default_profile_id(super_engine, workspace_id) == profile_id


def test_downgrade_keeps_the_default_and_reupgrade_rebuilds_the_pool(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, profile_id, _ = seed_legacy_workspace(
        super_engine, profile=("Our tuning", CUSTOM)
    )
    command.upgrade(config, REVISION)

    command.downgrade(config, PREVIOUS)

    with super_engine.connect() as db:
        remaining = db.execute(
            text("SELECT id, name, is_active FROM scoring_profile WHERE workspace_id = :ws"),
            {"ws": workspace_id},
        ).all()
    assert [(row.id, row.name, row.is_active) for row in remaining] == [
        (profile_id, "Our tuning", True)
    ]

    command.upgrade(config, REVISION)
    assert len(pool(super_engine, workspace_id)) == 4
    assert default_profile_id(super_engine, workspace_id) == profile_id


def test_new_workspace_gets_its_pool_through_the_application_role(database):
    from codesage_api.services.auth import IdentityClaims, establish_session

    config, _engine, super_engine = database
    command.upgrade(config, "head")
    claims = IdentityClaims(
        sub=str(uuid.uuid4()),
        email="creator@example.test",
        name="Creator",
        picture=None,
        identity_provider="github",
    )
    with Session(super_engine) as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        record = establish_session(db, claims)
        workspace_id = record.workspace_id
        db.commit()

    rows = pool(super_engine, workspace_id)
    assert len(rows) == 3
    assert all(row.kind == "built_in" for row in rows.values())
    assert rows[default_profile_id(super_engine, workspace_id)].preset_key == "balanced"


# ── the five-custom limit ───────────────────────────────────────────────────


def test_five_custom_profiles_are_allowed_and_the_sixth_is_refused(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, _, _ = seed_legacy_workspace(super_engine)
    command.upgrade(config, "head")

    with super_engine.begin() as db:
        as_app(db, workspace_id)
        for index in range(5):
            insert_custom(db, workspace_id, f"Custom {index}")

    with (
        pytest.raises(DBAPIError, match="maximum of 5 custom scoring profiles"),
        super_engine.begin() as db,
    ):
        as_app(db, workspace_id)
        insert_custom(db, workspace_id, "Custom 6")

    with super_engine.connect() as db:
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM scoring_profile "
                    "WHERE workspace_id = :ws AND kind = 'custom'"
                ),
                {"ws": workspace_id},
            )
            == 5
        )
    # Built-ins never counted toward the limit.
    assert len(pool(super_engine, workspace_id)) == 8


def test_concurrent_creation_cannot_bypass_the_five_custom_limit(database):
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    workspace_id, _, _ = seed_legacy_workspace(super_engine)
    command.upgrade(config, "head")
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        for index in range(4):
            insert_custom(db, workspace_id, f"Custom {index}")

    ready = threading.Barrier(2)
    outcomes: list[BaseException | None] = [None, None]

    def create(slot: int) -> None:
        try:
            with super_engine.begin() as db:
                as_app(db, workspace_id)
                ready.wait(timeout=30)
                insert_custom(db, workspace_id, f"Racing {slot}")
        except BaseException as exc:  # noqa: BLE001 -- recorded, then asserted on
            outcomes[slot] = exc

    threads = [threading.Thread(target=create, args=(slot,)) for slot in (0, 1)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
        assert not thread.is_alive(), "custom-limit serialization deadlocked"

    failures = [item for item in outcomes if item is not None]
    assert len(failures) == 1, f"expected exactly one refusal, got {outcomes}"
    assert "maximum of 5 custom scoring profiles" in str(failures[0])
    with super_engine.connect() as db:
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM scoring_profile "
                    "WHERE workspace_id = :ws AND kind = 'custom'"
                ),
                {"ws": workspace_id},
            )
            == 5
        )


# ── immutability, references and deletion ───────────────────────────────────


@pytest.fixture
def workspaces(database):
    """Two migrated workspaces, each with a repository, under the head revision."""
    config, _engine, super_engine = database
    command.upgrade(config, PREVIOUS)
    first = seed_legacy_workspace(super_engine, repository=True)
    second = seed_legacy_workspace(super_engine, repository=True)
    command.upgrade(config, "head")
    return super_engine, first, second


def built_in_id(db_engine, workspace_id, preset_key="security_first"):
    with db_engine.connect() as db:
        return db.scalar(
            text(
                "SELECT id FROM scoring_profile "
                "WHERE workspace_id = :ws AND preset_key = :key"
            ),
            {"ws": workspace_id, "key": preset_key},
        )


def test_built_in_profiles_refuse_updates_and_deletes(workspaces):
    super_engine, (workspace_id, _, _), _ = workspaces
    target = built_in_id(super_engine, workspace_id)

    with pytest.raises(DBAPIError, match="cannot be modified"), super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(
            text("UPDATE scoring_profile SET security_weight = 9 WHERE id = :id"),
            {"id": target},
        )
    with pytest.raises(DBAPIError, match="cannot be modified"), super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(
            text("UPDATE scoring_profile SET name = 'Renamed' WHERE id = :id"),
            {"id": target},
        )
    with pytest.raises(DBAPIError, match="cannot be deleted"), super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(text("DELETE FROM scoring_profile WHERE id = :id"), {"id": target})

    with super_engine.connect() as db:
        assert (
            db.scalar(
                text("SELECT security_weight FROM scoring_profile WHERE id = :id"),
                {"id": target},
            )
            == 3.0
        )


def test_a_custom_profile_cannot_be_promoted_to_a_built_in(workspaces):
    super_engine, (workspace_id, _, _), _ = workspaces
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        custom = insert_custom(db, workspace_id, "Ours")

    with (
        pytest.raises(DBAPIError, match="cannot become a built-in"),
        super_engine.begin() as db,
    ):
        as_app(db, workspace_id)
        db.execute(
            text("UPDATE scoring_profile SET kind = 'built_in' WHERE id = :id"),
            {"id": custom},
        )


def test_a_profile_in_use_cannot_be_deleted(workspaces):
    """Both kinds of use refuse the delete, and each names the rule that fired.

    Custom profiles throughout, so the built-in guard cannot stand in for either
    foreign key and quietly make this test pass for the wrong reason.
    """
    super_engine, (workspace_id, _, repository_id), _ = workspaces
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        assigned = insert_custom(db, workspace_id, "Assigned")
        chosen = insert_custom(db, workspace_id, "Chosen")
        unused = insert_custom(db, workspace_id, "Unused")
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {"repo": repository_id, "ws": workspace_id, "profile": assigned},
        )
        db.execute(
            text(
                "UPDATE workspace_profile_settings SET default_scoring_profile_id = :profile "
                "WHERE workspace_id = :ws"
            ),
            {"profile": chosen, "ws": workspace_id},
        )

    with (
        pytest.raises(IntegrityError, match="fk_repository_profile_assignment_scoring_profile"),
        super_engine.begin() as db,
    ):
        as_app(db, workspace_id)
        db.execute(text("DELETE FROM scoring_profile WHERE id = :id"), {"id": assigned})

    with (
        pytest.raises(IntegrityError, match="fk_workspace_profile_settings_default_scoring"),
        super_engine.begin() as db,
    ):
        as_app(db, workspace_id)
        db.execute(text("DELETE FROM scoring_profile WHERE id = :id"), {"id": chosen})

    # An unused custom profile deletes cleanly.
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(text("DELETE FROM scoring_profile WHERE id = :id"), {"id": unused})
    remaining = pool(super_engine, workspace_id)
    assert unused not in remaining
    assert {assigned, chosen} <= set(remaining)


def test_a_project_cannot_reference_another_workspaces_profile(workspaces):
    super_engine, (first_ws, _, first_repo), (second_ws, _, _) = workspaces
    foreign = built_in_id(super_engine, second_ws)

    for workspace_id, repository_id, profile_id in (
        (first_ws, first_repo, foreign),
        (second_ws, first_repo, foreign),
    ):
        with pytest.raises(IntegrityError), super_engine.begin() as db:
            db.execute(
                text(
                    "INSERT INTO repository_profile_assignment "
                    "(repository_id, workspace_id, scoring_profile_id) "
                    "VALUES (:repo, :ws, :profile)"
                ),
                {"repo": repository_id, "ws": workspace_id, "profile": profile_id},
            )


def test_a_project_has_at_most_one_override(workspaces):
    super_engine, (workspace_id, _, repository_id), _ = workspaces
    first = built_in_id(super_engine, workspace_id, "balanced")
    second = built_in_id(super_engine, workspace_id, "delivery_speed")
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {"repo": repository_id, "ws": workspace_id, "profile": first},
        )
    with pytest.raises(IntegrityError), super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {"repo": repository_id, "ws": workspace_id, "profile": second},
        )


def test_removing_a_repository_removes_only_its_assignment(workspaces):
    super_engine, (workspace_id, _, repository_id), _ = workspaces
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {
                "repo": repository_id,
                "ws": workspace_id,
                "profile": built_in_id(super_engine, workspace_id),
            },
        )

    with super_engine.begin() as db:
        as_app(db, workspace_id)
        db.execute(text("DELETE FROM repository WHERE id = :id"), {"id": repository_id})

    with super_engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM repository_profile_assignment")) == 0
    assert len(pool(super_engine, workspace_id)) == 3


def test_removing_a_workspace_removes_its_pool_settings_and_assignments(workspaces):
    super_engine, (workspace_id, _, repository_id), (other_ws, _, _) = workspaces
    with super_engine.begin() as db:
        as_app(db, workspace_id)
        insert_custom(db, workspace_id, "Ours")
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {
                "repo": repository_id,
                "ws": workspace_id,
                "profile": built_in_id(super_engine, workspace_id),
            },
        )

    # The built-in guard must not turn a deletable workspace into a permanent one.
    with super_engine.begin() as db:
        db.execute(text("DELETE FROM workspace WHERE id = :id"), {"id": workspace_id})

    assert pool(super_engine, workspace_id) == {}
    assert default_profile_id(super_engine, workspace_id) is None
    with super_engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM repository_profile_assignment")) == 0
    assert len(pool(super_engine, other_ws)) == 3


# ── tenant isolation ────────────────────────────────────────────────────────


def test_the_new_tables_are_filtered_by_the_bound_workspace(workspaces):
    super_engine, (first_ws, _, first_repo), (second_ws, _, _) = workspaces
    with super_engine.begin() as db:
        as_app(db, first_ws)
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {
                "repo": first_repo,
                "ws": first_ws,
                "profile": built_in_id(super_engine, first_ws),
            },
        )

    with super_engine.begin() as db:
        as_app(db, second_ws)
        assert db.scalar(text("SELECT count(*) FROM repository_profile_assignment")) == 0
        assert db.scalar(text("SELECT count(*) FROM workspace_profile_settings")) == 1
        assert (
            db.scalar(text("SELECT workspace_id FROM workspace_profile_settings")) == second_ws
        )

    with super_engine.begin() as db:
        db.execute(text("SET LOCAL ROLE codesage_app"))
        assert db.scalar(text("SELECT count(*) FROM workspace_profile_settings")) == 0
        assert db.scalar(text("SELECT count(*) FROM repository_profile_assignment")) == 0


def test_a_bound_workspace_cannot_write_another_workspaces_rows(workspaces):
    super_engine, (first_ws, _, _), (second_ws, _, second_repo) = workspaces

    with pytest.raises(DBAPIError), super_engine.begin() as db:
        as_app(db, first_ws)
        db.execute(
            text(
                "INSERT INTO repository_profile_assignment "
                "(repository_id, workspace_id, scoring_profile_id) "
                "VALUES (:repo, :ws, :profile)"
            ),
            {
                "repo": second_repo,
                "ws": second_ws,
                "profile": built_in_id(super_engine, second_ws),
            },
        )

    with super_engine.begin() as db:
        as_app(db, first_ws)
        changed = db.execute(
            text(
                "UPDATE workspace_profile_settings SET default_scoring_profile_id = :profile "
                "WHERE workspace_id = :ws"
            ),
            {"profile": built_in_id(super_engine, second_ws), "ws": second_ws},
        )
        assert changed.rowcount == 0
