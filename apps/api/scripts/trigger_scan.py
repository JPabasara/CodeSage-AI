"""Enqueue one scan and watch it run. Development tool — not shipped, not imported.

Salvaged from `feature/setup-celery-redis` (`apps/ml/src/trigger.py`), which proved
the async pipeline end to end. The idea survived; almost none of the code did,
because that branch was written against a mock worker and this one talks to the
real pipeline. What changed and why:

  * **It takes an attempt id, not a repository URL.** `run_scan(attempt_id)` runs an
    ANALYSIS_ATTEMPT row that already exists — `POST /api/repos/{repo_id}/scan`
    creates it. A scan is not "analyse this URL"; it is "carry out this attempt",
    which is what lets a cancelled attempt structurally never produce a snapshot
    (locked decision 9).

  * **Progress is read from Redis, phase from PostgreSQL — never from Celery.**
    `tasks/app.py` sets `backend=None` on purpose: the outcome of a scan is the
    attempt row and its snapshot, not a task return value. So `result.ready()`,
    `result.state` and `result.info` — the whole polling loop on that branch —
    cannot work here. There is no result backend to ask.

  * **It prints only what was measured.** The old version printed a CK report
    (WMC, CBO, LCOM, debt-hours) that the mock worker invented. Numbers that look
    like measurements but are not are worse than no numbers, so they are gone.
    This tool reports phase, percent and elapsed time — three things that are true.

Usage::

    python scripts/trigger_scan.py <attempt_id> --workspace <workspace_id>
    python scripts/trigger_scan.py <attempt_id> --workspace <workspace_id> --watch

`--workspace` is required because ANALYSIS_ATTEMPT is behind row-level security:
the policy joins branch → repository → workspace, so nothing is visible until a
workspace is bound. That is the same rule the API obeys on every request; this
script does not get an exemption just because it is run by hand.
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid

import redis
from sqlalchemy import select

from codesage_api.config import get_settings
from codesage_api.db.enums import AnalysisStatus
from codesage_api.db.models import AnalysisAttempt
from codesage_api.db.rls import set_workspace_context
from codesage_api.db.session import SessionLocal
from codesage_api.tasks.progress import PROGRESS_KEY
from codesage_api.tasks.scan_pipeline import run_scan

#: Phases the worker cannot move out of. Matches the contract's ScanPhase.
TERMINAL = {AnalysisStatus.DONE, AnalysisStatus.ERROR, AnalysisStatus.CANCELLED}

POLL_SECONDS = 1.0


def _read_attempt(workspace_id: uuid.UUID, attempt_id: uuid.UUID) -> AnalysisAttempt | None:
    """One short read with the workspace bound.

    A new session per poll, deliberately. `set_config(..., true)` is scoped to the
    transaction, and holding one open for the length of a scan would pin a
    connection for minutes to read a single column.
    """
    session = SessionLocal()
    try:
        set_workspace_context(session, workspace_id)
        return session.scalar(select(AnalysisAttempt).where(AnalysisAttempt.id == attempt_id))
    finally:
        session.close()


def _read_percent(client: redis.Redis, attempt_id: uuid.UUID) -> int:
    """Progress, or 0 if the key has not been written yet or has expired.

    Reads the key directly rather than calling `tasks.progress.read_progress()`,
    which is still a skeleton. The key *format* is imported, so there is one
    definition of it; switch to the function once it has a body.
    """
    raw = client.get(PROGRESS_KEY.format(attempt_id=attempt_id))
    try:
        return int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Enqueue one scan and watch it run.")
    parser.add_argument("attempt_id", type=uuid.UUID, help="ANALYSIS_ATTEMPT to run")
    parser.add_argument(
        "--workspace", type=uuid.UUID, required=True, help="workspace that owns it (RLS)"
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="follow an attempt that is already queued instead of enqueuing a new one",
    )
    args = parser.parse_args()

    attempt = _read_attempt(args.workspace, args.attempt_id)
    if attempt is None:
        # Indistinguishable, and deliberately so: RLS gives a caller from the wrong
        # workspace the same answer as a caller asking for a row that never existed.
        print(
            f"No attempt {args.attempt_id} visible in workspace {args.workspace}.\n"
            "It does not exist, or it belongs to a different workspace.",
            file=sys.stderr,
        )
        return 2

    print(f"attempt  {attempt.id}")
    print(f"commit   {attempt.commit_sha}")
    print(f"phase    {attempt.status.value}")

    if not args.watch:
        if attempt.status in TERMINAL:
            print(
                f"\nRefusing to enqueue: this attempt already finished as "
                f"'{attempt.status.value}'. Start a new scan, or pass --watch.",
                file=sys.stderr,
            )
            return 2
        run_scan.delay(str(args.attempt_id))
        print("enqueued codesage.scan")

    client = redis.from_url(get_settings().redis_url, decode_responses=True)
    started = time.monotonic()
    last_line = None

    while True:
        attempt = _read_attempt(args.workspace, args.attempt_id)
        if attempt is None:
            print("\nThe attempt disappeared mid-scan.", file=sys.stderr)
            return 2

        percent = _read_percent(client, args.attempt_id)
        line = f"  {attempt.status.value:<10} {percent:>3}%"
        if line != last_line:
            print(line)
            last_line = line

        if attempt.status in TERMINAL:
            break
        time.sleep(POLL_SECONDS)

    elapsed = time.monotonic() - started
    print(f"\n{attempt.status.value} after {elapsed:.1f}s")

    if attempt.status is AnalysisStatus.ERROR:
        # Stored on the row, not merely logged — SP-13 requires it to be
        # recoverable from the database alone.
        print(f"reason: {attempt.failure_information or '(none recorded)'}", file=sys.stderr)

    return 0 if attempt.status is AnalysisStatus.DONE else 1


if __name__ == "__main__":
    raise SystemExit(main())
