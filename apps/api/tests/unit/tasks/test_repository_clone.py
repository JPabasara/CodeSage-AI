from __future__ import annotations

import uuid
from pathlib import Path

from codesage_api.tasks.repository_clone import CloneError, clone_at_commit


def test_clone_checks_out_exact_sha_and_reads_committer_date(
    monkeypatch, tmp_path: Path
) -> None:
    sha = "a" * 40
    commands: list[tuple[tuple[str, ...], Path | None]] = []

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

    monkeypatch.setattr("codesage_api.tasks.repository_clone._git", fake_git)

    clone = clone_at_commit(
        "https://github.com/example/project.git",
        sha,
        uuid.uuid4(),
        clone_root=tmp_path / "clones",
    )

    assert clone.commit_sha == sha
    assert clone.committer_date.tzinfo is not None
    assert (clone.path / "A.java").is_file()
    assert any(args[:2] == ("checkout", "--detach") for args, _cwd in commands)


def test_clone_rejects_non_uuid_attempt_directory(tmp_path: Path) -> None:
    try:
        clone_at_commit(
            "https://github.com/example/project.git",
            "abc",
            "../escape",
            clone_root=tmp_path,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("invalid attempt id was accepted")


def test_clone_does_not_reuse_existing_attempt_directory(tmp_path: Path) -> None:
    attempt_id = uuid.uuid4()
    (tmp_path / str(attempt_id)).mkdir()
    try:
        clone_at_commit(
            "https://github.com/example/project.git",
            "abc",
            attempt_id,
            clone_root=tmp_path,
        )
    except CloneError:
        pass
    else:
        raise AssertionError("existing clone directory was reused")


def test_clone_rejects_non_github_or_non_https_url(tmp_path: Path) -> None:
    for url in ("http://github.com/example/project.git", "https://example.com/repo.git"):
        try:
            clone_at_commit(url, "a" * 40, uuid.uuid4(), clone_root=tmp_path)
        except CloneError:
            pass
        else:
            raise AssertionError(f"unsafe clone URL was accepted: {url}")
