"""Scan progress and the cancel flag — the two things Redis owns.

**Redis and PostgreSQL have separate responsibilities**:

    PostgreSQL  phase          done | error | cancelled must survive a restart
    Redis       progress %     losing it costs nothing; the next poll recomputes
    Redis       stage details  the same: stage, step, commits/files read, typical duration
    Redis       cancel flag    transient by nature; a restart cancels nothing

Losing a percentage on a broker restart is harmless. Losing the fact that a scan
failed would break diagnosis, which needs the final phase and its error message to
be recoverable from the database alone — so every terminal phase is written to the
attempt row by the process that reaches it.

Keys expire, so a crashed worker cannot leave a stale 47% or a cancel flag that
silently kills the next scan of the same attempt.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

from codesage_api.config import get_settings

PROGRESS_KEY = "codesage:scan:{attempt_id}:progress"
STAGE_KEY = "codesage:scan:{attempt_id}:stage"
CANCEL_KEY = "codesage:scan:{attempt_id}:cancel"
#: Set when a score calculation is queued, so polls do not queue it again.
SCORE_QUEUED_KEY = "codesage:score:{cache_id}:queued"
SCORE_QUEUED_TTL_SECONDS = 120

#: Long enough to outlive any realistic scan, short enough that abandoned keys go away.
KEY_TTL_SECONDS = 6 * 60 * 60


@lru_cache
def _client() -> Redis:
    return Redis.from_url(
        get_settings().redis_url,
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
    )


def publish_progress(attempt_id: str, percent: int) -> None:
    """Publish 0–100 for the polling client. Called at pipeline stage and sub-stage milestones."""
    bounded = max(0, min(100, int(percent)))
    try:
        _client().set(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            bounded,
            ex=KEY_TTL_SECONDS,
        )
    except RedisError:
        return


@dataclass(frozen=True, slots=True)
class ProgressReading:
    """Everything a status poll shows about a running scan, from one round trip."""

    percent: int = 0
    stage: str | None = None
    step: str | None = None
    commits_done: int | None = None
    commits_total: int | None = None
    files_done: int | None = None
    files_total: int | None = None
    typical_seconds: int | None = None


#: Fields that belong to one sub-step of `reading_code` and must not outlive it.
_STEP_FIELDS = ("step", "commits_done", "commits_total", "files_done", "files_total")


def _count(value: str | None) -> int | None:
    try:
        return max(0, int(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


def publish_stage(
    attempt_id: str,
    stage: str,
    percent: int,
    *,
    files_total: int | None = None,
    typical_seconds: int | None = None,
) -> None:
    """Enter a pipeline stage: its name and the percentage where its band starts.

    Entering a stage resets the sub-step and its counters, so a count from
    reading code never shows under a later stage. Never raises — progress is
    decoration.
    """
    fields: dict[Any, Any] = {"stage": stage}
    if files_total is not None:
        fields["files_total"] = max(0, int(files_total))
        fields["files_done"] = 0
    if typical_seconds is not None:
        fields["typical_seconds"] = max(0, int(typical_seconds))
    key = STAGE_KEY.format(attempt_id=attempt_id)
    try:
        pipe = _client().pipeline(transaction=False)
        pipe.hdel(key, *(name for name in _STEP_FIELDS if name not in fields))
        pipe.hset(key, mapping=fields)
        pipe.expire(key, KEY_TTL_SECONDS)
        pipe.set(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            max(0, min(100, int(percent))),
            ex=KEY_TTL_SECONDS,
        )
        pipe.execute()
    except RedisError:
        return


def publish_step(
    attempt_id: str,
    step: str,
    percent: int,
    *,
    files_total: int | None = None,
    commits_total: int | None = None,
) -> None:
    """Enter a sub-step of `reading_code`, with the percentage where its band starts.

    A step carries only its own counter, starting at 0: the others are dropped,
    so "340 of 1,212 commits" never shows while comments are being read. Never
    raises — progress is decoration.
    """
    fields: dict[Any, Any] = {"step": step}
    if commits_total is not None:
        fields["commits_total"] = max(0, int(commits_total))
        fields["commits_done"] = 0
    if files_total is not None:
        fields["files_total"] = max(0, int(files_total))
        fields["files_done"] = 0
    key = STAGE_KEY.format(attempt_id=attempt_id)
    try:
        pipe = _client().pipeline(transaction=False)
        pipe.hdel(key, *(name for name in _STEP_FIELDS if name not in fields))
        pipe.hset(key, mapping=fields)
        pipe.expire(key, KEY_TTL_SECONDS)
        pipe.set(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            max(0, min(100, int(percent))),
            ex=KEY_TTL_SECONDS,
        )
        pipe.execute()
    except RedisError:
        return


def publish_commits_done(attempt_id: str, commits_done: int) -> None:
    """How many commits have been read so far, inside `reading_history`."""
    try:
        _client().hset(
            STAGE_KEY.format(attempt_id=attempt_id),
            "commits_done",
            max(0, int(commits_done)),
        )
    except RedisError:
        return


def publish_files_done(attempt_id: str, files_done: int) -> None:
    """How many Java files have been read so far, inside `reading_comments`."""
    try:
        _client().hset(
            STAGE_KEY.format(attempt_id=attempt_id),
            "files_done",
            max(0, int(files_done)),
        )
    except RedisError:
        return


def read_status(attempt_id: str) -> ProgressReading:
    """Percentage and stage details in one round trip. Never raises: a missing
    or unreadable value reads as "not reported"."""
    try:
        pipe = _client().pipeline(transaction=False)
        pipe.get(PROGRESS_KEY.format(attempt_id=attempt_id))
        pipe.hgetall(STAGE_KEY.format(attempt_id=attempt_id))
        raw_percent, details = pipe.execute()
    except RedisError:
        return ProgressReading()
    details = details if isinstance(details, dict) else {}
    percent = _count(raw_percent)
    return ProgressReading(
        percent=min(100, percent) if percent is not None else 0,
        stage=details.get("stage") or None,
        step=details.get("step") or None,
        commits_done=_count(details.get("commits_done")),
        commits_total=_count(details.get("commits_total")),
        files_done=_count(details.get("files_done")),
        files_total=_count(details.get("files_total")),
        typical_seconds=_count(details.get("typical_seconds")),
    )


def read_progress(attempt_id: str) -> int:
    """Current percentage, or 0 if the key is gone. Never raises — a missing
    percentage must not turn a status poll into a 500."""
    try:
        value = _client().get(PROGRESS_KEY.format(attempt_id=attempt_id))
        return max(0, min(100, int(value))) if value is not None else 0
    except (RedisError, TypeError, ValueError):
        return 0


def claim_score_enqueue(cache_id: str) -> bool:
    """True for the first caller in a while to queue this score; False while an
    earlier one is still queued.

    The dashboard polls every few seconds while a score is pending, and each
    poll used to queue the same job again — twenty copies for one score. Fails
    open: without Redis, queueing twice is better than never.
    """
    try:
        return bool(
            _client().set(
                SCORE_QUEUED_KEY.format(cache_id=cache_id),
                "1",
                nx=True,
                ex=SCORE_QUEUED_TTL_SECONDS,
            )
        )
    except RedisError:
        return True


def request_cancel(attempt_id: str) -> None:
    """Set the cancel flag and return. Does not stop the worker."""
    _client().set(
        CANCEL_KEY.format(attempt_id=attempt_id),
        "1",
        ex=KEY_TTL_SECONDS,
    )


def is_cancel_requested(attempt_id: str) -> bool:
    """Checked by the worker BETWEEN pipeline stages, never during finalization."""
    try:
        return _client().get(CANCEL_KEY.format(attempt_id=attempt_id)) == "1"
    except RedisError:
        return False


def clear(attempt_id: str) -> None:
    """Drop every key once the attempt reaches a terminal phase."""
    try:
        _client().delete(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            CANCEL_KEY.format(attempt_id=attempt_id),
            STAGE_KEY.format(attempt_id=attempt_id),
        )
    except RedisError:
        return
