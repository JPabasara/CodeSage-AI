from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

EXCLUDED_DIRECTORY_NAMES = frozenset(
    {".git", ".gradle", "target", "build", "generated", "generated-sources", "vendor", "third_party"}
)


def iter_java_files(repository_path: Path) -> Iterator[Path]:
    for path in sorted(repository_path.rglob("*.java")):
        relative_parts = path.relative_to(repository_path).parts
        if not EXCLUDED_DIRECTORY_NAMES.intersection(relative_parts):
            yield path
