"""Celery worker entrypoint.

    celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1

Same image as the API, different command (SAD §7). They share `db/`, `schemas/`
and the domain model, so shipping two images would mean maintaining the same
contract on both sides of a network boundary.

`--concurrency=1` is the sane default here: each concurrent scan needs its own
clone and roughly 2 GB of scratch disk, so concurrency is scaled by adding worker
*containers* rather than threads inside one. PERF-07 asks for at least three
concurrent analyses, which is three worker containers.
"""

from __future__ import annotations

from codesage_api.config import get_settings
from codesage_api.logging import configure_logging
from codesage_api.tasks.app import celery_app

configure_logging(get_settings().log_level)

# Importing the task modules registers them with the Celery app.
import codesage_api.tasks.scan_pipeline  # noqa: E402,F401

__all__ = ["celery_app"]
