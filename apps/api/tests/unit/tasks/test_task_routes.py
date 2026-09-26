"""Every task must land on a queue some worker actually listens on.

A task missing from `task_routes` goes to Celery's default queue, which no
worker in Compose or k3s consumes, so it is accepted and then never runs.
`warm_profile_scores` shipped that way: the warm-up after a profile change was
silently dropped.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

import codesage_api.worker  # noqa: F401  (registers every task)
from codesage_api.tasks.app import celery_app

# tests/unit/tasks/ -> tests -> apps/api -> apps -> repository root
REPO_ROOT = Path(__file__).resolve().parents[5]


def _compose_queues() -> set[str]:
    compose = (REPO_ROOT / "infra/docker-compose.yml").read_text(encoding="utf-8")
    return set(re.findall(r"celery .*? -Q (\S+)", compose))


def _k3s_queues() -> set[str]:
    queues: set[str] = set()
    for manifest in (REPO_ROOT / "infra/k3s").rglob("*.yaml"):
        for document in yaml.safe_load_all(manifest.read_text(encoding="utf-8")):
            spec = (document or {}).get("spec", {}).get("template", {}).get("spec", {})
            for container in spec.get("containers", []):
                args = container.get("args", [])
                queues.update(
                    args[i + 1] for i, arg in enumerate(args[:-1]) if arg == "-Q"
                )
    return queues


def _our_tasks() -> list[str]:
    return sorted(name for name in celery_app.tasks if name.startswith("codesage."))


def test_both_deployments_consume_the_same_queues() -> None:
    assert _compose_queues() == _k3s_queues() == {"scans", "scoring"}


def test_every_task_is_routed_to_a_consumed_queue() -> None:
    consumed = _compose_queues()
    routes = celery_app.conf.task_routes
    tasks = _our_tasks()

    assert "codesage.warm_profile_scores" in tasks
    unrouted = [name for name in tasks if name not in routes]
    assert unrouted == [], f"these would go to the default queue and never run: {unrouted}"
    orphaned = {name: routes[name]["queue"] for name in tasks if routes[name]["queue"] not in consumed}
    assert orphaned == {}, f"routed to a queue no worker listens on: {orphaned}"
