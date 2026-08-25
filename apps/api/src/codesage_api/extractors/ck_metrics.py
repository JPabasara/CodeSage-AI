"""What the CK tool tells us about one Java file.

CK is a Java program the worker runs as a separate process. This class is only
the shape of its output, so the rest of the code can be written and type-checked
before the tool is wired up.
"""

from __future__ import annotations

import csv
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from codesage_api.config import get_settings


@dataclass(frozen=True, slots=True)
class FileMetrics:
    path: str
    loc: int
    cyclomatic_complexity: float
    max_nesting_depth: int
    method_count: int
    longest_method_lines: int


class CKExtractionError(RuntimeError):
    """CK was unavailable or returned output that could not be consumed."""


def _number(row: dict[str, str], key: str) -> float:
    value = row.get(key, "")
    return float(value) if value else 0.0


def _relative_path(raw_path: str, repository_path: Path) -> str:
    path = Path(raw_path)
    try:
        return path.resolve().relative_to(repository_path.resolve()).as_posix()
    except ValueError:
        return path.as_posix().lstrip("./")


def _read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def extract_ck_metrics(
    repository_path: Path,
    *,
    ck_jar: Path | None = None,
) -> list[FileMetrics]:
    """Run CK once and aggregate its class/method CSV output per Java file."""
    jar = ck_jar or Path(get_settings().ck_jar)
    if not jar.is_file():
        raise CKExtractionError(f"CK jar was not found at {jar}.")

    with tempfile.TemporaryDirectory(prefix="codesage-ck-") as directory:
        output = Path(directory)
        try:
            subprocess.run(
                [
                    "java",
                    "-jar",
                    str(jar),
                    str(repository_path),
                    "false",
                    "0",
                    "false",
                    str(output),
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise CKExtractionError("CK could not extract Java metrics.") from exc

        class_rows = _read_rows(output / "class.csv")
        method_rows = _read_rows(output / "method.csv")

    aggregated: dict[str, dict[str, float]] = {}
    for row in class_rows:
        path = _relative_path(row.get("file", ""), repository_path)
        if not path.endswith(".java"):
            continue
        values = aggregated.setdefault(
            path,
            {"loc": 0.0, "complexity": 0.0, "nesting": 0.0, "methods": 0.0, "longest": 0.0},
        )
        values["loc"] += _number(row, "loc")
        values["complexity"] += _number(row, "wmc")
        values["nesting"] = max(values["nesting"], _number(row, "maxNestedBlocksQty"))
        values["methods"] += _number(row, "totalMethodsQty")

    for row in method_rows:
        path = _relative_path(row.get("file", ""), repository_path)
        if path in aggregated:
            aggregated[path]["longest"] = max(
                aggregated[path]["longest"], _number(row, "loc")
            )

    return [
        FileMetrics(
            path=path,
            loc=int(values["loc"]),
            cyclomatic_complexity=values["complexity"],
            max_nesting_depth=int(values["nesting"]),
            method_count=int(values["methods"]),
            longest_method_lines=int(values["longest"]),
        )
        for path, values in sorted(aggregated.items())
    ]
