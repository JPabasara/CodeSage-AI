
from __future__ import annotations

import logging

from codesage_api.config import get_settings
from codesage_api.logging import configure_logging
from codesage_api.tasks.app import celery_app

configure_logging(get_settings().log_level)


logging.getLogger("pydriller.repository").setLevel(logging.WARNING)


import codesage_api.tasks.scan_pipeline  # noqa: F401
import codesage_api.tasks.score_cache  # noqa: F401

__all__ = ["celery_app"]
