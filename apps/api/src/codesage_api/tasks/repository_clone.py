"""Create an isolated, immutable working tree for one analysis attempt."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from codesage_api.config import get_settings

#: Blobs above this are left on GitHub. Measured on joda-money (429 commits):
#: `--filter=blob:none` made the PyDriller history walk 47x slower (542 s against
#: 11.6 s), because every historical diff fetched its blobs one commit at a time.
#: A size limit keeps every source-sized blob local, so the walk costs the same
#: as a full clone, and skips only the binaries and datasets that make a
#: repository huge.
BLOB_SIZE_FILTER = "blob:limit=1m"


class CloneError(RuntimeError):
    """The repository could not be cloned or pinned to the requested revision."""


class CloneTimedOut(CloneError):
    """A git command outlived `git_timeout_seconds` and was killed."""


@dataclass(frozen=True, slots=True)
class ClonedRepository:
    path: Path
    commit_sha: str
    committer_date: datetime


def _git(*args: str, cwd: Path | None = None) -> str:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=cwd,
            env=env,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            # `run` kills the child when this expires.
            timeout=get_settings().git_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise CloneTimedOut("Git did not finish in time.") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CloneError("Git could not prepare the repository for analysis.") from exc
    return completed.stdout.strip()


def clone_path(attempt_id: str | uuid.UUID, *, clone_root: Path | None = None) -> Path:
    """Where this attempt's clone lives. Known before cloning, so the pipeline
    can delete it in `finally` even when the clone itself was interrupted."""
    safe_attempt_id = uuid.UUID(str(attempt_id))
    root = clone_root or Path(get_settings().clone_dir)
    return root / str(safe_attempt_id)


def clone_at_commit(
    repository_url: str,
    commit_sha: str,
    attempt_id: str | uuid.UUID,
    *,
    branch: str,
    clone_root: Path | None = None,
) -> ClonedRepository:
    """Clone one branch's history and check out the scanned commit.

    One branch, because the process metrics walk only the history behind the
    scanned commit, and that commit is on `branch`.
    """

    parsed_url = urlparse(repository_url)
    if parsed_url.scheme != "https" or parsed_url.hostname != "github.com":
        raise CloneError("Only public GitHub HTTPS repositories can be cloned.")

    destination = clone_path(attempt_id, clone_root=clone_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise CloneError("A clone already exists for this analysis attempt.")

    try:
        _git(
            "clone",
            "--no-checkout",
            "--no-hardlinks",
            "--single-branch",
            "--no-tags",
            f"--filter={BLOB_SIZE_FILTER}",
            f"--branch={branch}",
            "--",
            repository_url,
            str(destination),
        )
        _git("checkout", "--detach", commit_sha, cwd=destination)
        actual_sha = _git("rev-parse", "HEAD", cwd=destination)
        if actual_sha.lower() != commit_sha.lower():
            raise CloneError("The cloned repository does not match the requested commit.")
        committer_date = datetime.fromisoformat(
            _git("show", "-s", "--format=%cI", "HEAD", cwd=destination)
        )
    except BaseException:
        # BaseException: a soft time limit or a worker shutdown must not leave
        # half a clone behind either.
        shutil.rmtree(destination, ignore_errors=True)
        raise

    return ClonedRepository(destination, actual_sha, committer_date)


def sweep_stale_clones(older_than_seconds: float, *, clone_root: Path | None = None) -> int:
    """Delete attempt clones older than any live scan could be.

    A worker killed at the hard time limit never reaches its `finally`, so its
    clone would stay on disk for good. Only attempt-shaped (UUID) directories are
    touched; anything else in the root is left alone. Returns how many went.
    """
    root = clone_root or Path(get_settings().clone_dir)
    if not root.is_dir():
        return 0
    cutoff = time.time() - older_than_seconds
    removed = 0
    for entry in root.iterdir():
        try:
            uuid.UUID(entry.name)
        except ValueError:
            continue
        try:
            if entry.is_symlink() or not entry.is_dir():
                continue
            if entry.stat().st_mtime >= cutoff:
                continue
        except OSError:
            continue
        shutil.rmtree(entry, ignore_errors=True)
        removed += 1
    return removed


def remove_clone(path: Path) -> None:
    """Delete one validated scan directory without accepting an arbitrary path."""
    root = Path(get_settings().clone_dir).resolve()
    resolved = path.resolve()
    if resolved.parent != root:
        raise ValueError("Refusing to remove a directory outside the clone root.")
    shutil.rmtree(resolved, ignore_errors=True)
