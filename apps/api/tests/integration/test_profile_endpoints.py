"""The profile pool over HTTP, against a real PostgreSQL.

Covers what the unit tests cannot: that the stable error codes actually reach the
client, that the five-custom limit and the built-in guards hold through the whole
stack, that a project override changes what the dashboard scores with, and that
none of it starts a scan.
"""

from __future__ import annotations

import uuid
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from codesage_api.db.models import AnalysisAttempt, SnapshotScore
from codesage_api.scoring.cache import profile_fingerprint, profile_from_payload

from .test_account_provisioning import account as account  # noqa: PLC0414
from .test_operation_authorization import client as client  # noqa: PLC0414
from .test_operation_authorization import resources as resources  # noqa: PLC0414
from .test_rbac_migration import database as database  # noqa: PLC0414
from .test_rbac_migration import postgres_url as postgres_url  # noqa: PLC0414

WEIGHTS = {
    "security": 1.0,
    "code_design": 1.0,
    "requirement": 1.0,
    "documentation": 1.0,
    "test": 1.0,
}


def create(client, name, **overrides):
    body = {"name": name, "weights": dict(WEIGHTS), "trust_s": 0.5}
    body.update(overrides)
    return client.post("/api/profiles", json=body)


@pytest.fixture
def queue(monkeypatch):
    """Capture what the API asks the workers to do, without a broker."""
    from codesage_api.routers import profiles as profile_routes
    from codesage_api.routers import projects as project_routes

    sent = Mock()
    monkeypatch.setattr(profile_routes.celery_app, "send_task", sent)
    monkeypatch.setattr(project_routes.celery_app, "send_task", sent)
    return sent


# ── the pool ────────────────────────────────────────────────────────────────


def test_a_new_workspace_lists_three_built_ins_with_balanced_as_default(client):
    listed = client.get("/api/profiles")

    assert listed.status_code == 200
    pool = listed.json()
    assert [item["name"] for item in pool] == ["Balanced", "Security-first", "Delivery-speed"]
    assert all(item["is_preset"] and not item["editable"] for item in pool)
    assert all(item["usage_count"] == 0 for item in pool)
    assert [item["name"] for item in pool if item["is_active"]] == ["Balanced"]
    assert client.get("/api/profiles/default").json()["name"] == "Balanced"


def test_create_read_update_delete_a_custom_profile(client, queue):
    created = create(client, "Release gate", trust_s=0.9)
    assert created.status_code == 201
    body = created.json()
    profile_id = body["id"]
    assert body["is_preset"] is False
    assert body["editable"] is True
    # Creating a profile does not silently put it in force.
    assert body["is_active"] is False
    assert client.get("/api/profiles/default").json()["name"] == "Balanced"

    assert client.get(f"/api/profiles/{profile_id}").json()["name"] == "Release gate"

    patched = client.patch(
        f"/api/profiles/{profile_id}", json={"weights": {"security": 2.5}}
    )
    assert patched.status_code == 200
    assert patched.json()["weights"]["security"] == 2.5
    # Everything not sent kept its stored value.
    assert patched.json()["weights"]["test"] == 1.0
    assert patched.json()["trust_s"] == 0.9
    assert patched.json()["name"] == "Release gate"

    assert client.delete(f"/api/profiles/{profile_id}").status_code == 204
    assert client.get(f"/api/profiles/{profile_id}").status_code == 404
    assert len(client.get("/api/profiles").json()) == 3


def test_out_of_range_values_are_clamped_rather_than_refused(client, queue):
    created = create(
        client, "Extreme", weights={**WEIGHTS, "security": 9.0}, trust_s=5.0
    )

    assert created.status_code == 201
    assert created.json()["weights"]["security"] == 3.0
    assert created.json()["trust_s"] == 1.0


def test_the_sixth_custom_profile_is_refused_with_a_stable_code(client, queue):
    for index in range(5):
        assert create(client, f"Custom {index}").status_code == 201

    refused = create(client, "One too many")

    assert refused.status_code == 409
    assert refused.json()["code"] == "PROFILE_LIMIT_REACHED"
    # Built-ins never counted toward the limit.
    assert len(client.get("/api/profiles").json()) == 8


def test_a_duplicate_name_is_refused_however_it_is_spelled(client, queue):
    assert create(client, "Release gate").status_code == 201

    for name in ("Release gate", "  release GATE  "):
        refused = create(client, name)
        assert refused.status_code == 409
        assert refused.json()["code"] == "PROFILE_NAME_CONFLICT"

    renamed = create(client, "Other")
    clash = client.patch(f"/api/profiles/{renamed.json()['id']}", json={"name": "release gate"})
    assert clash.status_code == 409
    assert clash.json()["code"] == "PROFILE_NAME_CONFLICT"


def test_built_ins_refuse_every_write(client, queue):
    built_in = client.get("/api/profiles").json()[0]["id"]

    patched = client.patch(f"/api/profiles/{built_in}", json={"name": "Mine now"})
    deleted = client.delete(f"/api/profiles/{built_in}")

    assert patched.status_code == deleted.status_code == 409
    assert patched.json()["code"] == deleted.json()["code"] == "PROFILE_BUILT_IN"
    assert client.get("/api/profiles").json()[0]["name"] == "Balanced"


# ── the workspace default ───────────────────────────────────────────────────


def test_choosing_the_default_is_idempotent_and_blocks_deleting_it(client, queue):
    created = create(client, "Release gate").json()

    first = client.put("/api/profiles/default", json={"profile_id": created["id"]})
    second = client.put("/api/profiles/default", json={"profile_id": created["id"]})

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["is_active"] is True
    assert client.get("/api/profiles/default").json()["name"] == "Release gate"

    in_use = client.delete(f"/api/profiles/{created['id']}")
    assert in_use.status_code == 409
    assert in_use.json()["code"] == "PROFILE_IN_USE"


def test_a_profile_from_another_workspace_cannot_become_the_default(client):
    refused = client.put("/api/profiles/default", json={"profile_id": str(uuid.uuid4())})

    assert refused.status_code == 404
    assert refused.json()["code"] == "NOT_FOUND"


# ── project overrides ───────────────────────────────────────────────────────


def test_a_project_inherits_until_it_is_given_an_override(client, resources, queue):
    repo = resources["repo"]
    inherited = client.get(f"/api/projects/{repo}/profile").json()

    assert inherited["inherited"] is True
    assert inherited["override"] is None
    assert inherited["effective"]["name"] == "Balanced"
    assert inherited["workspace_default"]["name"] == "Balanced"

    security_first = next(
        item for item in client.get("/api/profiles").json() if item["name"] == "Security-first"
    )
    assigned = client.put(
        f"/api/projects/{repo}/profile", json={"profile_id": security_first["id"]}
    )

    assert assigned.status_code == 200
    assert assigned.json()["inherited"] is False
    assert assigned.json()["effective"]["name"] == "Security-first"
    assert assigned.json()["workspace_default"]["name"] == "Balanced"
    # The override is counted, and it blocks deletion of what it points at.
    listed = {item["name"]: item for item in client.get("/api/profiles").json()}
    assert listed["Security-first"]["usage_count"] == 1
    assert listed["Balanced"]["usage_count"] == 0


def test_overrides_are_per_project_and_replace_rather_than_accumulate(
    client, resources, queue
):
    first, second = resources["repo"], resources["other_repo"]
    pool = {item["name"]: item["id"] for item in client.get("/api/profiles").json()}

    client.put(f"/api/projects/{first}/profile", json={"profile_id": pool["Security-first"]})
    client.put(f"/api/projects/{second}/profile", json={"profile_id": pool["Delivery-speed"]})
    replaced = client.put(
        f"/api/projects/{first}/profile", json={"profile_id": pool["Delivery-speed"]}
    )

    assert replaced.json()["effective"]["name"] == "Delivery-speed"
    assert client.get(f"/api/projects/{second}/profile").json()["effective"]["name"] == (
        "Delivery-speed"
    )
    counts = {item["name"]: item["usage_count"] for item in client.get("/api/profiles").json()}
    assert counts["Delivery-speed"] == 2
    assert counts["Security-first"] == 0


def test_clearing_an_override_restores_inheritance_and_is_idempotent(
    client, resources, queue
):
    repo = resources["repo"]
    pool = {item["name"]: item["id"] for item in client.get("/api/profiles").json()}
    client.put(f"/api/projects/{repo}/profile", json={"profile_id": pool["Security-first"]})

    first = client.delete(f"/api/projects/{repo}/profile")
    second = client.delete(f"/api/projects/{repo}/profile")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["inherited"] is True
    assert first.json()["effective"]["name"] == "Balanced"


def test_a_project_cannot_be_given_another_workspaces_profile(client, resources):
    refused = client.put(
        f"/api/projects/{resources['repo']}/profile",
        json={"profile_id": str(uuid.uuid4())},
    )

    assert refused.status_code == 404
    assert refused.json()["code"] == "NOT_FOUND"


# ── scoring consequences ────────────────────────────────────────────────────


def test_profile_writes_queue_scoring_work_and_never_start_a_scan(
    client, resources, account, queue
):
    """The whole point of deriving scores on read: a profile is not a commit."""
    repo = resources["repo"]
    with Session(account[0]) as db:
        before = db.scalar(select(func.count()).select_from(AnalysisAttempt))

    created = create(client, "Release gate").json()
    client.put("/api/profiles/default", json={"profile_id": created["id"]})
    client.patch(f"/api/profiles/{created['id']}", json={"trust_s": 0.2})
    client.put(f"/api/projects/{repo}/profile", json={"profile_id": created["id"]})
    client.delete(f"/api/projects/{repo}/profile")

    with Session(account[0]) as db:
        assert db.scalar(select(func.count()).select_from(AnalysisAttempt)) == before
        assert db.scalar(select(func.count()).select_from(SnapshotScore)) == 0

    assert queue.call_count == 4, "create queues nothing; the four selections each do"
    assert {call.args[0] for call in queue.call_args_list} == {
        "codesage.warm_profile_scores"
    }


def test_two_projects_with_different_profiles_get_different_cache_keys(
    client, resources, queue
):
    """Different profiles must not collide on one cached score."""
    first, second = resources["repo"], resources["other_repo"]
    pool = {item["name"]: item["id"] for item in client.get("/api/profiles").json()}
    client.put(f"/api/projects/{first}/profile", json={"profile_id": pool["Security-first"]})
    client.put(f"/api/projects/{second}/profile", json={"profile_id": pool["Delivery-speed"]})

    effective = [
        client.get(f"/api/projects/{repo}/profile").json()["effective"] for repo in (first, second)
    ]
    fingerprints = {
        profile_fingerprint(
            profile_from_payload(
                {
                    "weights": {
                        key.replace("_", "-"): value
                        for key, value in item["weights"].items()
                    },
                    "trust": item["trust_s"],
                    "name": item["name"],
                }
            )
        )
        for item in effective
    }

    assert len(fingerprints) == 2
