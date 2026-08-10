"""HTTP client for the ML inference container (SAD §7).

Called by workers only — the API process never performs inference.

**Failure here is not failure of the scan.** Both models live in one container, so
they are reachable or unreachable together; when they are not, the pipeline
persists a valid snapshot with rule findings only. This module's job is therefore
to fail *fast and predictably* rather than to retry hard: a scan that hangs for
minutes waiting on a dead container is worse than one that degrades in seconds.
"""

from __future__ import annotations

from typing import Any

import httpx

from codesage_api.config import get_settings
from codesage_api.errors import MLServiceUnavailable


def _client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(
        base_url=settings.ml_service_url,
        timeout=settings.ml_timeout_seconds,
    )


def post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to the inference service, converting any transport failure into
    MLServiceUnavailable so callers have exactly one exception to handle.

    Timeouts, connection errors and 5xx all mean the same thing to the pipeline —
    "no predictions this time" — so collapsing them here keeps the degraded-mode
    branch in `scan_pipeline` to a single `except`.
    """
    raise MLServiceUnavailable


def model_versions() -> dict[str, str]:
    """The deployed SATD and risk model versions.

    Recorded against the analysis attempt so a snapshot always identifies what
    produced it, which is what keeps trend points comparable after a retraining.
    """
    raise NotImplementedError
