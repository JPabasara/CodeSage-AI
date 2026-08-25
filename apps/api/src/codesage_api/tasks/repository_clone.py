"""Create an isolated, immutable working tree for one analysis attempt."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from codesage_api.config import get_settings


class CloneError(RuntimeError):
    """The repository could not be cloned or pinned to the requested revision."""


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
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CloneError("Git could not prepare the repository for analysis.") from exc
    return completed.stdout.strip()


def clone_at_commit(
    repository_url: str,
    commit_sha: str,
    attempt_id: str | uuid.UUID,
    *,
    clone_root: Path | None = None,
) -> ClonedRepository:
    """Clone the repository and detach HEAD at the attempt's immutable SHA."""
    parsed_url = urlparse(repository_url)
    if parsed_url.scheme != "https" or parsed_url.hostname != "github.com":
        raise CloneError("Only public GitHub HTTPS repositories can be cloned.")
    safe_attempt_id = uuid.UUID(str(attempt_id))
    root = clone_root or Path(get_settings().clone_dir)
    root.mkdir(parents=True, exist_ok=True)
    destination = root / str(safe_attempt_id)
    if destination.exists():
        raise CloneError("A clone already exists for this analysis attempt.")

    try:
        _git(
            "clone",
            "--no-checkout",
            "--no-hardlinks",
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
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise

    return ClonedRepository(destination, actual_sha, committer_date)


def remove_clone(path: Path) -> None:
    """Delete one validated scan directory without accepting an arbitrary path."""
    root = Path(get_settings().clone_dir).resolve()
    resolved = path.resolve()
    if resolved.parent != root:
        raise ValueError("Refusing to remove a directory outside the clone root.")
    shutil.rmtree(resolved, ignore_errors=True)
