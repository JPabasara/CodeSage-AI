from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ClasspathResult:
    entries: tuple[Path, ...] = ()
    source: str = "unavailable"

    @property
    def available(self) -> bool:
        return bool(self.entries)


class ClasspathProvider(Protocol):
    def resolve(self, repository_path: Path) -> ClasspathResult: ...


class NoTrustedClasspath:
    def resolve(self, repository_path: Path) -> ClasspathResult:
        del repository_path
        return ClasspathResult()
