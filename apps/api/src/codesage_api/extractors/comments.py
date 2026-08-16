"""One comment pulled out of a source file.

`text` is what the classifier reads. `line` is what the finding points at, so a
user can click straight to it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractedComment:
    file_path: str
    line: int
    text: str