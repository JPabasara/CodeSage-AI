from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class JavaVersion:
    version: str | None
    source: str
    preview: bool = False


_PATTERNS = (
    ("pom.xml", (r"<maven\.compiler\.(?:release|source|target)>\s*([^<]+)", r"<(?:release|source|target)>\s*([^<]+)")),
    ("build.gradle", (r"(?:sourceCompatibility|targetCompatibility)\s*=\s*['\"]?(?:JavaVersion\.VERSION_)?([\d_.]+)", r"JavaLanguageVersion\.of\((\d+)\)")),
    ("build.gradle.kts", (r"(?:sourceCompatibility|targetCompatibility)\s*=\s*JavaVersion\.VERSION_([\d_]+)", r"JavaLanguageVersion\.of\((\d+)\)")),
    ("gradle.properties", (r"(?:javaVersion|sourceCompatibility|targetCompatibility)\s*=\s*([^\s]+)",)),
)


def detect_java_version(repository_path: Path) -> JavaVersion:
    for filename, patterns in _PATTERNS:
        path = repository_path / filename
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in patterns:
            if match := re.search(pattern, text):
                raw = match.group(1).strip().replace("VERSION_", "").replace("_", ".")
                raw = raw.removeprefix("1.")
                if raw.isdigit():
                    return JavaVersion(raw, filename)
    return JavaVersion(None, "unresolved")
