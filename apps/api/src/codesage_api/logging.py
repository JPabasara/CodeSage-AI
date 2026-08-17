"""Structured logging with a scan_id that survives every process hop.

SAD §11 (traceability): *"Every log line across the API, broker, workers and ML
service carries the same scan identifier, so one scan is traceable end to end."*
That only works if the id is ambient rather than passed by hand — a single log
call that forgets the kwarg breaks the trace. Hence a ContextVar: the router or
the Celery task binds it once at the entry point, and every log line below picks
it up automatically.

Note this is the *diagnostic* half of the pair. The other half is durable: the
final phase and error of every scan are stored on the SCAN row, so a user-reported
failure is diagnosable without reading logs at all.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager

_scan_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("scan_id", default=None)


@contextmanager
def scan_context(scan_id: str) -> Iterator[None]:
    """Bind ``scan_id`` to every log line emitted inside this block."""
    token = _scan_id.set(scan_id)
    try:
        yield
    finally:
        _scan_id.reset(token)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if (scan_id := _scan_id.get()) is not None:
            payload["scan_id"] = scan_id
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger. Called once at startup."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
