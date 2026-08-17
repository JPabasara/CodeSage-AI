from __future__ import annotations

from pathlib import Path


def detect_hardcoded_secret(file_path: Path, source: str) -> list[dict]:
    raise NotImplementedError


def detect_sql_concat(file_path: Path, source: str) -> list[dict]:
    raise NotImplementedError
