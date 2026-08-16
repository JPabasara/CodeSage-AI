"""What the commit history tells us about one file.

Read from the repository's git log, not from the code itself. Two files can look
identical and still differ here — one has been rewritten forty times this month
and the other has not been touched in two years.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileProcessMetrics:
    path: str
    commit_count: int
    distinct_authors: int
    lines_added: int
    lines_deleted: int
    days_since_last_change: int
