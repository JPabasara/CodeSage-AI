"""Cooperative cancellation (SRS FR-6).

**Why the worker is not killed.** Celery can revoke a task with SIGTERM, and that
is the wrong tool here. The pipeline's last stage writes a Snapshot with its files,
metrics, findings and predictions; a signal arriving mid-write would leave a
partial snapshot that reads exactly like a complete one. FR-6 requires the previous
snapshot to remain intact after a cancellation, and DBR-22 requires that a
cancelled attempt never be presented as a finalized result — neither survives a
forced kill.

So cancellation is a flag the worker reads at stage boundaries:

    stage 1 ─┬─ check ─┬─ stage 2 ─┬─ check ─┬─ stage 3 ─┬─ check ─┬─ FINALIZE
             │         │           │         │           │         │  (no check;
             ▼         ▼           ▼         ▼           ▼         ▼   runs to
            stop      stop        stop      stop        stop      stop  completion)

The accepted cost is latency: a user who presses Stop waits for the current stage
to end. The gain is that "cancelled" always means the database is in a clean state.
"""

from __future__ import annotations

import shutil

from codesage_api.tasks import progress


class ScanCancelled(Exception):
    """Raised at a stage boundary when the cancel flag is set.

    Caught by the pipeline, which deletes the clone, writes phase `cancelled` to
    the attempt row and returns. Not an error path — nothing failed.
    """


def check(attempt_id: str) -> None:
    """Raise ScanCancelled if cancellation has been requested.

    Called between stages, never inside finalization.
    """
    if progress.is_cancel_requested(attempt_id):
        raise ScanCancelled


def cleanup(attempt_id: str, clone_dir: str | None) -> None:
    """Release the clone and clear the Redis keys.

    The ~2 GB of scratch disk must be released when a scan completes, fails **or is
    cancelled** — a worker that leaked one clone per cancelled scan would fill its
    disk and take out every subsequent scan on that container.
    """
    if clone_dir is not None:
        shutil.rmtree(clone_dir, ignore_errors=True)
    progress.clear(attempt_id)
