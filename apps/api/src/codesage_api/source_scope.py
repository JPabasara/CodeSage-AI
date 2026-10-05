from __future__ import annotations

from fnmatch import fnmatchcase
from typing import Any

DEFAULT_TEST_PATHS = (
    "**/src/test/**",
    "**/src/integrationTest/**",
    "**/test/**",
    "**/tests/**",
)


def _matches(path: str, pattern: str) -> bool:
    candidate = path.replace("\\", "/").lstrip("/")
    normalized = pattern.replace("\\", "/").lstrip("/")
    return fnmatchcase(candidate, normalized) or fnmatchcase("/" + candidate, normalized)


def classify_source_scope(
    path: str,
    test_paths: list[str] | None = None,
    production_paths: list[str] | None = None,
) -> str:
    """Classify a persisted source file; explicit production overrides win."""
    normalized = path.replace("\\", "/").lstrip("/")
    if any(_matches(normalized, pattern) for pattern in (production_paths or [])):
        return "production"
    if is_excluded_path(normalized, list(test_paths or DEFAULT_TEST_PATHS), production_paths or []):
        return "test"
    parts = {part.lower() for part in normalized.split("/")}
    if parts.intersection({"generated", "generated-sources", "gen"}):
        return "generated"
    if parts.intersection({"example", "examples", "sample", "samples"}):
        return "example"
    if "src" in parts and "main" in parts:
        return "production"
    return "unknown"


def scan_scope_config(repository: Any) -> dict[str, Any]:
    """Freeze the settings that affect analyzed facts, independently of visibility."""
    return {
        "test_path_patterns": list(
            getattr(repository, "test_path_patterns", None) or DEFAULT_TEST_PATHS
        ),
        "production_path_overrides": list(
            getattr(repository, "production_path_overrides", None) or []
        ),
        "scan_excluded_directories": bool(getattr(repository, "scan_excluded_directories", False)),
    }


def is_excluded_path(path: str, test_paths: list[str], production_paths: list[str]) -> bool:
    return any(_matches(path, pattern) for pattern in test_paths) and not any(
        _matches(path, pattern) for pattern in production_paths
    )
