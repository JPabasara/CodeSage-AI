"""Scan-time repository guardrails (13H.1)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from codesage_api import guardrails
from codesage_api.config import Settings
from codesage_api.guardrails import (
    NO_JAVA_MESSAGE,
    ScanLimitReached,
    cap_satd_comments,
    check_java_sources,
    count_java,
    timed_out_message,
)
from codesage_api.scoring.enums import ScanErrorCode


def _limits(monkeypatch, **overrides: int) -> None:
    monkeypatch.setattr(guardrails, "get_settings", lambda: Settings(**overrides))


def _java(root: Path, relative: str, lines: int) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"// line {i}\n" for i in range(lines)), encoding="utf-8")


def test_count_reads_the_working_tree_but_not_git_internals(tmp_path: Path) -> None:
    _java(tmp_path, "src/A.java", 10)
    _java(tmp_path, "src/deep/B.java", 5)
    _java(tmp_path, ".git/objects/C.java", 1000)
    (tmp_path / "README.md").write_text("# not java\n" * 50, encoding="utf-8")

    assert count_java(tmp_path) == guardrails.JavaInventory(files=2, lines=15)


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_count_never_follows_a_symlink(tmp_path: Path) -> None:
    _java(tmp_path, "A.java", 3)
    # A hostile repository: reading this would never finish.
    (tmp_path / "Zero.java").symlink_to("/dev/zero")

    assert count_java(tmp_path).files == 1


def test_a_branch_with_no_java_ends_cleanly_with_its_code(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text("print('hi')\n", encoding="utf-8")

    with pytest.raises(ScanLimitReached) as ended:
        check_java_sources(tmp_path)

    assert ended.value.code is ScanErrorCode.NO_JAVA_FILES
    assert ended.value.message == NO_JAVA_MESSAGE
    assert ended.value.message.startswith("No Java files on this branch.")


def test_too_many_java_files_names_the_limit(monkeypatch, tmp_path: Path) -> None:
    _limits(monkeypatch, max_java_files=2)
    for name in ("A", "B", "C"):
        _java(tmp_path, f"{name}.java", 1)

    with pytest.raises(ScanLimitReached) as ended:
        check_java_sources(tmp_path)

    assert ended.value.code is ScanErrorCode.REPOSITORY_TOO_LARGE
    assert ended.value.message == (
        "This branch has 3 Java files, more than the 2 CodeSage can analyse today."
    )


def test_too_many_java_lines_names_the_limit(monkeypatch, tmp_path: Path) -> None:
    _limits(monkeypatch, max_java_lines=1_000)
    _java(tmp_path, "Big.java", 1_500)

    with pytest.raises(ScanLimitReached) as ended:
        check_java_sources(tmp_path)

    assert ended.value.code is ScanErrorCode.REPOSITORY_TOO_LARGE
    assert ended.value.message == (
        "This branch has 1,500 lines of Java, more than the 1,000 CodeSage can analyse today."
    )


def test_exactly_at_the_limits_is_allowed(monkeypatch, tmp_path: Path) -> None:
    _limits(monkeypatch, max_java_files=2, max_java_lines=10)
    _java(tmp_path, "A.java", 5)
    _java(tmp_path, "B.java", 5)

    assert check_java_sources(tmp_path) == guardrails.JavaInventory(files=2, lines=10)


def test_satd_comments_are_capped_in_file_order(monkeypatch) -> None:
    _limits(monkeypatch, max_satd_comments=3)

    assert cap_satd_comments(list(range(10))) == [0, 1, 2]
    assert cap_satd_comments([0, 1]) == [0, 1]


def test_the_timeout_sentence_names_the_configured_limit(monkeypatch) -> None:
    assert timed_out_message().startswith("The scan took longer than 15 minutes")

    _limits(monkeypatch, scan_time_limit_seconds=600, scan_soft_time_limit_seconds=540)
    assert timed_out_message().startswith("The scan took longer than 10 minutes")


def test_the_soft_limit_must_come_before_the_hard_limit() -> None:
    # Otherwise the worker is killed first, and nothing ends the scan cleanly.
    with pytest.raises(ValueError, match="SOFT_TIME_LIMIT"):
        Settings(scan_time_limit_seconds=600, scan_soft_time_limit_seconds=600)


def test_every_limit_has_a_code_default() -> None:
    settings = Settings()
    assert settings.max_repository_size_mb == 300
    assert settings.scan_time_limit_seconds == 15 * 60
    assert settings.scan_soft_time_limit_seconds == 14 * 60
    assert settings.max_running_scans_per_workspace == 1
