"""What the CK tool tells us about one Java file.

CK is a Java program the worker runs as a separate process. This class is only
the shape of its output, so the rest of the code can be written and type-checked
before the tool is wired up.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileMetrics:
    path: str
    loc: int
    cyclomatic_complexity: float
    max_nesting_depth: int
    method_count: int
    longest_method_lines: int
