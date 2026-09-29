from __future__ import annotations

from fnmatch import fnmatchcase

DEFAULT_TEST_PATHS = (
    "**/src/test/**",
    "**/src/integrationTest/**",
    "**/test/**",
    "**/tests/**",
)


def _matches(path: str, pattern: str) -> bool:
    candidate = path.replace("\\", "/").lstrip("/")
    normalized = pattern.replace("\\", "/").lstrip("/")
    return fnmatchcase(candidate, normalized) or fnmatchcase("/" + candidate, "*/" + normalized)


def classify_source_scope(
    path: str,
    test_paths: list[str] | None = None,
    production_paths: list[str] | None = None,
) -> str:
    """Classify a persisted source file; explicit production overrides win."""
    normalized = path.replace("\\", "/").lstrip("/")
    if any(_matches(normalized, pattern) for pattern in (production_paths or [])):
        return "production"
    parts = {part.lower() for part in normalized.split("/")}
    if parts.intersection({"generated", "generated-sources", "gen"}):
        return "generated"
    if any(
        _matches(normalized, pattern)
        for pattern in (test_paths or DEFAULT_TEST_PATHS)
    ):
        return "test"
    if parts.intersection({"example", "examples", "sample", "samples"}):
        return "example"
    if "src" in parts and "main" in parts:
        return "production"
    return "unknown"
