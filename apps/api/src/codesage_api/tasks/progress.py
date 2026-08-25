"""Scan progress and the cancel flag — the two things Redis owns.

**The split between Redis and PostgreSQL is deliberate** (SAD §6 decision 6):

    PostgreSQL  phase          done | error | cancelled must survive a restart
    Redis       progress %     losing it costs nothing; the next poll recomputes
    Redis       cancel flag    transient by nature; a restart cancels nothing

Losing a percentage on a broker restart is harmless. Losing the fact that a scan
failed would break SP-13, which requires the final phase and its error message to
be recoverable from the database alone — so every terminal phase is written to the
attempt row by the process that reaches it.

Keys expire, so a crashed worker cannot leave a stale 47% or a cancel flag that
silently kills the next scan of the same attempt.
"""

from __future__ import annotations

from functools import lru_cache

from redis import Redis
from redis.exceptions import RedisError

from codesage_api.config import get_settings

PROGRESS_KEY = "codesage:scan:{attempt_id}:progress"
CANCEL_KEY = "codesage:scan:{attempt_id}:cancel"

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
    """Publish 0–100 for the polling client. Called at each stage boundary."""
    bounded = max(0, min(100, int(percent)))
    try:
        _client().set(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            bounded,
            ex=KEY_TTL_SECONDS,
        )
    except RedisError:
        return


def read_progress(attempt_id: str) -> int:
    """Current percentage, or 0 if the key is gone. Never raises — a missing
    percentage must not turn a status poll into a 500."""
    try:
        value = _client().get(PROGRESS_KEY.format(attempt_id=attempt_id))
        return max(0, min(100, int(value))) if value is not None else 0
    except (RedisError, TypeError, ValueError):
        return 0


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
    """Drop both keys once the attempt reaches a terminal phase."""
    try:
        _client().delete(
            PROGRESS_KEY.format(attempt_id=attempt_id),
            CANCEL_KEY.format(attempt_id=attempt_id),
        )
    except RedisError:
        return
