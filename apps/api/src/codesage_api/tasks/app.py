"""The Celery application.

Each scan is an independent task, so one repository's failure cannot affect
another's (REL-02). Celery's own retry handles transient faults — a GitHub blip, a
momentary ML timeout — before an attempt is reported as failed (REL-04).
"""

from __future__ import annotations

from celery import Celery

from codesage_api.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "codesage",
    broker=_settings.redis_url,
    backend=None,  # results live in PostgreSQL, not in the broker — see below
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # A scan is minutes long; prefetching several would leave jobs queued behind a
    # busy worker while another sits idle.
    worker_prefetch_multiplier=1,
    # Acknowledge only after the task finishes, so a worker crash re-queues the
    # scan rather than losing it.
    task_acks_late=True,
    task_track_started=True,
    # Retries are for TRANSIENT faults only. A rule-engine bug must fail loudly and
    # be recorded on the attempt row, not be silently retried three times.
    task_default_retry_delay=30,
    task_max_retries=3,
    task_routes={
        "codesage.scan": {"queue": "scans"},
        "codesage.score_snapshot": {"queue": "scoring"},
        "codesage.warm_snapshot_score": {"queue": "scoring"},
        "codesage.warm_workspace_scores": {"queue": "scoring"},
    },
)

# NOTE: no Celery result backend. The scan's outcome is not a task return value —
# it is the AnalysisAttempt row and its Snapshot. Storing results in Redis as well
# would create a second, expiring source of truth for something SP-13 requires to
# be durable in PostgreSQL.

celery_app.autodiscover_tasks(["codesage_api.tasks"])
