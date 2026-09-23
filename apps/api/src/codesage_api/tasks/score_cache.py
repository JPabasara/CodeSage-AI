"""Asynchronous calculation of profile-dependent snapshot scores."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from codesage_api.db.models import Repository, SnapshotScore
from codesage_api.db.repositories import dashboard as dashboard_repository
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import session_scope
from codesage_api.logging import get_logger
from codesage_api.scoring.cache import profile_from_payload, profile_payload
from codesage_api.services import dashboard, profiles
from codesage_api.tasks.app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="codesage.score_snapshot")
def score_snapshot(
    cache_id: str, workspace_id: str, profile_data: dict[str, object]
) -> None:
    """Calculate one prepared cache record; PostgreSQL is the result backend."""
    cache_uuid = uuid.UUID(cache_id)
    workspace_uuid = uuid.UUID(workspace_id)
    try:
        with session_scope() as session:
            set_workspace_context(session, workspace_uuid)
            cached = session.get(SnapshotScore, cache_uuid)
            if cached is None or cached.status == "ready":
                return
            cached.status = "running"
            cached.started_at = datetime.now(UTC)
            cached.failure_information = None

        with session_scope() as session:
            set_workspace_context(session, workspace_uuid)
            cached = session.get(SnapshotScore, cache_uuid)
            if cached is None or cached.status == "ready":
                return
            dashboard.calculate_snapshot_score(
                session, workspace_uuid, cached, profile_from_payload(profile_data)
            )
            cached.status = "ready"
            cached.completed_at = datetime.now(UTC)
    except Exception:
        logger.exception("Snapshot score calculation failed", extra={"cache_id": cache_id})
        with session_scope() as session:
            set_workspace_context(session, workspace_uuid)
            cached = session.get(SnapshotScore, cache_uuid)
            if cached is not None:
                cached.status = "error"
                cached.completed_at = datetime.now(UTC)
                cached.failure_information = "Score calculation failed."


def _warm(workspace_uuid: uuid.UUID, only: set[uuid.UUID] | None) -> list[tuple[str, dict[str, object]]]:
    """Prepare default-branch scores, each project under ITS effective profile.

    `only` narrows the work to the projects a particular change affected, so
    editing a profile one project uses does not re-score the whole workspace.
    """
    jobs: list[tuple[str, dict[str, object]]] = []
    with session_scope() as session:
        set_workspace_context(session, workspace_uuid)
        pool = profiles.load_pool(session, workspace_uuid)
        repositories = session.scalars(
            select(Repository)
            .where(Repository.workspace_id == workspace_uuid)
            .options(selectinload(Repository.branches))
        ).all()
        for repository in repositories:
            if only is not None and repository.id not in only:
                continue
            branch = next((item for item in repository.branches if item.is_default), None)
            if branch is None:
                continue
            profile = profiles.to_scoring_profile(pool.for_repository(repository.id))
            refs = dashboard_repository.list_completed_snapshot_refs(
                session, workspace_uuid, repository.id, branch.name
            )
            for ref in refs:
                cached, created = dashboard.prepare_snapshot_score(session, ref, profile)
                if created or (
                    cached.status == "pending" and cached.started_at is None
                ):
                    jobs.append((str(cached.id), profile_payload(profile)))
    return jobs


@celery_app.task(name="codesage.warm_workspace_scores")
def warm_workspace_scores(workspace_id: str) -> None:
    """Prepare the latest snapshots for every project in the workspace."""
    workspace_uuid = uuid.UUID(workspace_id)
    for cache_id, payload in _warm(workspace_uuid, None):
        score_snapshot.delay(cache_id, workspace_id, payload)


@celery_app.task(name="codesage.warm_profile_scores")
def warm_profile_scores(workspace_id: str, profile_id: str) -> None:
    """Re-warm only the projects whose effective profile is this one.

    That is the projects assigned to it, plus — when it is the workspace default
    — every project with no override. A profile nothing uses queues no work at
    all, which is why creating or deleting one costs nothing.
    """
    workspace_uuid = uuid.UUID(workspace_id)
    with session_scope() as session:
        set_workspace_context(session, workspace_uuid)
        affected = set(
            profiles.repositories_using(session, workspace_uuid, uuid.UUID(profile_id))
        )
    if not affected:
        return
    for cache_id, payload in _warm(workspace_uuid, affected):
        score_snapshot.delay(cache_id, workspace_id, payload)


@celery_app.task(name="codesage.warm_snapshot_score")
def warm_snapshot_score(snapshot_id: str, workspace_id: str) -> None:
    """Prepare and enqueue the effective-profile score after a scan completes."""
    workspace_uuid = uuid.UUID(workspace_id)
    with session_scope() as session:
        set_workspace_context(session, workspace_uuid)
        snapshot = dashboard_repository.get_snapshot_for_scoring(
            session, workspace_uuid, uuid.UUID(snapshot_id)
        )
        if snapshot is None:
            return
        repository_id = dashboard_repository.repository_id_for_snapshot(
            session, workspace_uuid, uuid.UUID(snapshot_id)
        )
        if repository_id is None:
            return
        profile = profiles.resolve_effective(session, workspace_uuid, repository_id)
        cached, created = dashboard.prepare_snapshot_score(session, snapshot, profile)
        cache_id = str(cached.id)
        payload = profile_payload(profile)
    if created or (cached.status == "pending" and cached.started_at is None):
        score_snapshot.delay(cache_id, workspace_id, payload)
