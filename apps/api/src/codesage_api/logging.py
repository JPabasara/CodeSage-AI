from __future__ import annotations

import contextvars
import json
import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager

_scan_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("scan_id", default=None)

_OBSERVABILITY_FIELDS = (
    "event",
    "stage",
    "duration_ms",
    "commits_inspected",
    "files_measured",
)


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
        for field in _OBSERVABILITY_FIELDS:
            if hasattr(record, field):
                payload[field] = getattr(record, field)
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
