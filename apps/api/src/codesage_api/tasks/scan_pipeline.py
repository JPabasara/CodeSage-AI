"""The scan pipeline — the write path (SRS FR-6, FR-7, FR-8, FR-9, FR-10, FR-21).

    clone → extract → detect → finalize

**The write path ends at "finalize". Scoring is not a pipeline stage.** It happens
later, in the API process, every time the dashboard is requested. If scoring ran
here, every profile change would require re-scanning every snapshot — which is
precisely the thing FR-20 promises never happens. The `workers never score` import
contract in pyproject.toml enforces this mechanically.

**The worker never calls the API.** It records phase by writing to
ANALYSIS_ATTEMPT and progress by publishing to Redis; the API serves the polling
client from those two sources. That keeps the dependency direction one-way and
matches the deployment view.
"""

from __future__ import annotations

import uuid

from codesage_api.tasks.app import celery_app


@celery_app.task(bind=True, name="codesage.scan")
def run_scan(self, attempt_id: str) -> None:  # noqa: ANN001
    """Execute one analysis attempt end to end.

    Stages, with a cancel check between each:

        1. clone at the scanned SHA, read its committer date
        2. extract  — CK metrics, PyDriller process metrics, Tree-sitter comments
        3. detect   — rule engine; then ML-1 and ML-2 (independent, may be issued
                      together, and skipped together if the service is down)
        4. finalize — one transaction: Snapshot + files + metrics + findings +
                      predictions, atomically (DBR-22)

    **The cancel check sits BETWEEN stages, never inside stage 4.** Once
    finalization begins the worker completes it, because a killed write would leave
    a partial snapshot and FR-6 requires the previous snapshot to survive a
    cancellation intact. The cost is that a user who presses Stop waits until the
    current stage ends.

    **Degraded mode.** If the ML container is unreachable, the attempt still
    finalizes: all rule and security findings present, no SATD findings, every
    risk_score 0.0 so risk_factor falls back to 1.0 and boosts nothing. Both models
    live in one container, so they are reachable or unreachable together.

    **On failure** the worker writes phase `error` and the reason onto the attempt
    row — stored, not merely logged, per SP-13. Nothing was written to Snapshot, so
    the previous snapshot is untouched and remains what the dashboard shows.

    Every log line inside this task carries the attempt id, via `scan_context`, so
    one scan is traceable across the API, the broker, the worker and the ML service.
    """
    raise NotImplementedError


def _finalize(attempt_id: uuid.UUID, results: dict) -> None:
    """Commit everything as a finalized result, or nothing at all (DBR-22, REL-05).

    Separated from `run_scan` so the transactional boundary is a single, obvious
    function rather than an indented block two hundred lines into a task.
    """
    raise NotImplementedError
