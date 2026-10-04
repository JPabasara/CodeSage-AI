"""Finished dashboard responses, named by their ETag.

A scored snapshot never changes for one (snapshot, profile, scoring engine), so
the expensive part of a dashboard read (fetching about a megabyte of JSON from
Postgres, validating it and serialising it again) gives the same bytes every
time. Only finding triage, a profile rename and new scans in the history change
what the reader sees, and all of those are part of the ETag.

Two layers use the same ETag:

    the browser   sends If-None-Match and gets 304 with no body
    this process  keeps the finished bytes, so another reader skips the work

The cache lives in process memory on purpose. Redis holds the Celery queue with
`noeviction`, and a cache there could fill it and stall scans.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Iterable

from pydantic import BaseModel

from codesage_api.config import get_settings

CACHE_CONTROL = "private, no-cache"


class ResponseCache:
    """Least-recently-used bytes, bounded by their total size."""

    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes
        self._entries: OrderedDict[str, bytes] = OrderedDict()
        self._size = 0
        # Sync endpoints run on a thread pool.
        self._lock = threading.Lock()

    def get(self, key: str) -> bytes | None:
        with self._lock:
            body = self._entries.get(key)
            if body is not None:
                self._entries.move_to_end(key)
            return body

    def put(self, key: str, body: bytes) -> None:
        # One response may not take more than a quarter of the space.
        if len(body) > self.max_bytes // 4:
            return
        with self._lock:
            previous = self._entries.pop(key, None)
            if previous is not None:
                self._size -= len(previous)
            self._entries[key] = body
            self._size += len(body)
            while self._size > self.max_bytes:
                _, evicted = self._entries.popitem(last=False)
                self._size -= len(evicted)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._size = 0

    @property
    def size(self) -> int:
        return self._size


responses = ResponseCache(get_settings().response_cache_megabytes * 1024 * 1024)


def etag_for(model: type[BaseModel], parts: Iterable[object]) -> str:
    """A strong ETag over everything that decides a response's bytes.

    The response model's schema is part of it, so a deploy that changes the
    shape never answers 304 to a browser holding the old shape.
    """
    digest = hashlib.sha256()
    digest.update(_schema_fingerprint(model).encode())
    for part in parts:
        digest.update(b"\x1f")
        digest.update(str(part).encode())
    return f'"{digest.hexdigest()[:40]}"'


_schemas: dict[type[BaseModel], str] = {}


def _schema_fingerprint(model: type[BaseModel]) -> str:
    known = _schemas.get(model)
    if known is None:
        known = hashlib.sha256(
            repr(sorted(model.model_json_schema().items())).encode()
        ).hexdigest()
        _schemas[model] = known
    return known


def matches(if_none_match: str | None, etag: str) -> bool:
    """Whether an If-None-Match header names this ETag (or anything, `*`)."""
    if not if_none_match:
        return False
    candidates = {item.strip().removeprefix("W/") for item in if_none_match.split(",")}
    return "*" in candidates or etag in candidates
