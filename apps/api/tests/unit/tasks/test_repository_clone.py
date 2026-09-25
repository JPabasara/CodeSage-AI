from __future__ import annotations

import os
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from codesage_api.tasks import repository_clone
from codesage_api.tasks.repository_clone import (
    CloneError,
    CloneTimedOut,
    clone_at_commit,
    clone_path,
    sweep_stale_clones,
)


def _fake_git(sha: str, commands: list[tuple[tuple[str, ...], Path | None]]):
    def fake_git(*args: str, cwd: Path | None = None) -> str:
        commands.append((args, cwd))
        if args[0] == "clone":
            Path(args[-1]).mkdir(parents=True)
            (Path(args[-1]) / "A.java").write_text("class A {}", encoding="utf-8")
            return ""
        if args[:2] == ("rev-parse", "HEAD"):
            return sha
        if args[:3] == ("show", "-s", "--format=%cI"):
            return "2026-08-01T10:30:00+00:00"
        return ""

    return fake_git


def test_clone_checks_out_exact_sha_and_reads_committer_date(
    monkeypatch, tmp_path: Path
) -> None:
    sha = "a" * 40
    commands: list[tuple[tuple[str, ...], Path | None]] = []
    monkeypatch.setattr("codesage_api.tasks.repository_clone._git", _fake_git(sha, commands))

    clone = clone_at_commit(
        "https://github.com/example/project.git",
        sha,
        uuid.uuid4(),
        branch="main",
        clone_root=tmp_path / "clones",
    )

    assert clone.commit_sha == sha
    assert clone.committer_date.tzinfo is not None
    assert (clone.path / "A.java").is_file()
    assert any(args[:2] == ("checkout", "--detach") for args, _cwd in commands)


def test_clone_fetches_one_branch_and_leaves_large_blobs_on_github(
    monkeypatch, tmp_path: Path
) -> None:
    commands: list[tuple[tuple[str, ...], Path | None]] = []
    monkeypatch.setattr(
        "codesage_api.tasks.repository_clone._git", _fake_git("a" * 40, commands)
    )

    clone_at_commit(
        "https://github.com/example/project.git",
        "a" * 40,
        uuid.uuid4(),
        branch="feature/login",
        clone_root=tmp_path,
    )

    clone = next(args for args, _cwd in commands if args[0] == "clone")
    assert "--single-branch" in clone
    assert "--branch=feature/login" in clone
    assert "--no-tags" in clone
    # Not blob:none: the process metrics walk every historical diff, and a
    # blobless clone fetches those blobs one commit at a time (47x slower,
    # measured). A size limit skips only binaries and datasets.
    assert "--filter=blob:limit=1m" in clone
    assert "--filter=blob:none" not in clone
    # The URL and the destination come after `--`, so neither can be read as
    # an option.
    assert clone[-3:] == (
        "--",
        "https://github.com/example/project.git",
        clone[-1],
    )


def test_a_failed_clone_leaves_no_directory_behind(monkeypatch, tmp_path: Path) -> None:
    attempt_id = uuid.uuid4()

    def fake_git(*args: str, cwd: Path | None = None) -> str:
        if args[0] == "clone":
            Path(args[-1]).mkdir(parents=True)
            (Path(args[-1]) / "partial.pack").write_bytes(b"x" * 64)
            return ""
        raise CloneError("checkout failed")

    monkeypatch.setattr("codesage_api.tasks.repository_clone._git", fake_git)

    with pytest.raises(CloneError):
        clone_at_commit(
            "https://github.com/example/project.git",
            "a" * 40,
            attempt_id,
            branch="main",
            clone_root=tmp_path,
        )

    assert not (tmp_path / str(attempt_id)).exists()


def test_a_git_command_that_runs_too_long_is_killed_and_reported(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def run(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        raise subprocess.TimeoutExpired(cmd="git clone", timeout=kwargs["timeout"])

    monkeypatch.setattr(repository_clone.subprocess, "run", run)

    with pytest.raises(CloneTimedOut):
        repository_clone._git("clone", "https://github.com/a/b")

    # Every git command gets the configured limit, not an open-ended wait.
    assert seen["timeout"] == 300


def test_a_timed_out_git_command_is_still_a_clone_error() -> None:
    # Callers that only know CloneError keep working.
    assert issubclass(CloneTimedOut, CloneError)


def test_clone_path_is_known_before_cloning(tmp_path: Path) -> None:
    attempt_id = uuid.uuid4()
    assert clone_path(attempt_id, clone_root=tmp_path) == tmp_path / str(attempt_id)


def test_clone_rejects_non_uuid_attempt_directory(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        clone_at_commit(
            "https://github.com/example/project.git",
            "abc",
            "../escape",
            branch="main",
            clone_root=tmp_path,
        )


def test_clone_does_not_reuse_existing_attempt_directory(tmp_path: Path) -> None:
    attempt_id = uuid.uuid4()
    (tmp_path / str(attempt_id)).mkdir()
    with pytest.raises(CloneError):
        clone_at_commit(
            "https://github.com/example/project.git",
            "abc",
            attempt_id,
            branch="main",
            clone_root=tmp_path,
        )


def test_clone_rejects_non_github_or_non_https_url(tmp_path: Path) -> None:
    for url in ("http://github.com/example/project.git", "https://example.com/repo.git"):
        with pytest.raises(CloneError):
            clone_at_commit(url, "a" * 40, uuid.uuid4(), branch="main", clone_root=tmp_path)


# ── clones left behind by a worker killed at the hard time limit ─────────────


def _age(path: Path, seconds: float) -> None:
    past = time.time() - seconds
    os.utime(path, (past, past))


def test_sweep_removes_only_old_attempt_clones(tmp_path: Path) -> None:
    old = tmp_path / str(uuid.uuid4())
    (old / "src").mkdir(parents=True)
    _age(old, 3600)
    live = tmp_path / str(uuid.uuid4())
    live.mkdir()
    unrelated = tmp_path / "not-a-scan"
    unrelated.mkdir()
    _age(unrelated, 3600)

    removed = sweep_stale_clones(1200, clone_root=tmp_path)

    assert removed == 1
    assert not old.exists()
    # A scan that is still running, and anything that is not ours, stay.
    assert live.exists()
    assert unrelated.exists()


def test_sweep_of_a_missing_root_is_a_no_op(tmp_path: Path) -> None:
    assert sweep_stale_clones(0, clone_root=tmp_path / "never-created") == 0
