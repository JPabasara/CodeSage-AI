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


@celery_app.task(name="codesage.warm_workspace_scores")
def warm_workspace_scores(workspace_id: str) -> None:
    """Prepare the latest two snapshots for every default branch after a profile change."""
    workspace_uuid = uuid.UUID(workspace_id)
    jobs: list[tuple[str, dict[str, object]]] = []
    with session_scope() as session:
        set_workspace_context(session, workspace_uuid)
        profile = profiles.get_active(session, workspace_uuid)
        repositories = session.scalars(
            select(Repository)
            .where(Repository.workspace_id == workspace_uuid)
            .options(selectinload(Repository.branches))
        ).all()
        for repository in repositories:
            branch = next((item for item in repository.branches if item.is_default), None)
            if branch is None:
                continue
            refs = dashboard_repository.list_completed_snapshot_refs(
                session, workspace_uuid, repository.id, branch.name
            )
            for ref in refs:
                cached, created = dashboard.prepare_snapshot_score(session, ref, profile)
                if created:
                    jobs.append((str(cached.id), profile_payload(profile)))
    for cache_id, payload in jobs:
        score_snapshot.delay(cache_id, workspace_id, payload)


@celery_app.task(name="codesage.warm_snapshot_score")
def warm_snapshot_score(snapshot_id: str, workspace_id: str) -> None:
    """Prepare and enqueue the active-profile score after a scan completes."""
    workspace_uuid = uuid.UUID(workspace_id)
    with session_scope() as session:
        set_workspace_context(session, workspace_uuid)
        snapshot = dashboard_repository.get_snapshot_for_scoring(
            session, workspace_uuid, uuid.UUID(snapshot_id)
        )
        if snapshot is None:
            return
        profile = profiles.get_active(session, workspace_uuid)
        cached, created = dashboard.prepare_snapshot_score(session, snapshot, profile)
        cache_id = str(cached.id)
        payload = profile_payload(profile)
    if created:
        score_snapshot.delay(cache_id, workspace_id, payload)
