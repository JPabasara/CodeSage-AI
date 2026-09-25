"""Scan-time repository guardrails (Phase 13H.1).

The connect-time checks answer from GitHub's metadata. These answer from the
branch actually checked out, which is the real answer: a branch can differ from
what GitHub reports for the default branch.

Every limit comes from settings, so 13I.4 can move them to the admin page
without touching this module. Every ending here is a *clean* one: a stable
`ScanErrorCode` plus one plain sentence stored on the attempt row, never a
stack trace.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from codesage_api.config import get_settings
from codesage_api.scoring.enums import ScanErrorCode

#: How long past the hard limit a RUNNING attempt must be before it is treated
#: as abandoned. The hard limit kills the worker process, so its `finally`
#: never runs and nothing else would ever end the row.
STALE_GRACE_SECONDS = 5 * 60


class ScanLimitReached(Exception):
    """A guardrail ended the scan. Carries the code and the stored sentence."""

    def __init__(self, code: ScanErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class JavaInventory:
    files: int
    lines: int


def _minutes(seconds: int) -> str:
    minutes = max(1, round(seconds / 60))
    return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"


def timed_out_message() -> str:
    limit = get_settings().scan_time_limit_seconds
    return (
        f"The scan took longer than {_minutes(limit)} and was stopped. "
        "Very large repositories may not finish in time."
    )


def git_timed_out_message() -> str:
    limit = get_settings().git_timeout_seconds
    return (
        f"Downloading the repository took longer than {_minutes(limit)} "
        "and was stopped."
    )


NO_JAVA_MESSAGE = (
    "No Java files on this branch. "
    "CodeSage reads Java for now; more languages are coming soon."
)


def count_java(repository_path: Path) -> JavaInventory:
    """Java files and lines in the working tree, the same files CK reads.

    Symlinks are skipped: a cloned `x.java -> /dev/zero` would never finish.
    """
    files = 0
    lines = 0
    for path in repository_path.rglob("*.java"):
        if ".git" in path.relative_to(repository_path).parts:
            continue
        if path.is_symlink() or not path.is_file():
            continue
        files += 1
        with path.open("rb") as handle:
            for _ in handle:
                lines += 1
    return JavaInventory(files=files, lines=lines)


def check_java_sources(repository_path: Path) -> JavaInventory:
    """Raise ScanLimitReached unless the branch has some, but not too much, Java."""
    settings = get_settings()
    inventory = count_java(repository_path)
    if inventory.files == 0:
        raise ScanLimitReached(ScanErrorCode.NO_JAVA_FILES, NO_JAVA_MESSAGE)
    if inventory.files > settings.max_java_files:
        raise ScanLimitReached(
            ScanErrorCode.REPOSITORY_TOO_LARGE,
            f"This branch has {inventory.files:,} Java files, more than the "
            f"{settings.max_java_files:,} CodeSage can analyse today.",
        )
    if inventory.lines > settings.max_java_lines:
        raise ScanLimitReached(
            ScanErrorCode.REPOSITORY_TOO_LARGE,
            f"This branch has {inventory.lines:,} lines of Java, more than the "
            f"{settings.max_java_lines:,} CodeSage can analyse today.",
        )
    return inventory


def cap_satd_comments[T](comments: list[T]) -> list[T]:
    """At most `max_satd_comments`, in file order, so the ML-1 batch stays inside
    its timeout instead of failing and losing SATD for the whole scan."""
    return comments[: get_settings().max_satd_comments]
