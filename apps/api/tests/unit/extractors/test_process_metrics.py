from __future__ import annotations

import logging
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar

import pytest

from codesage_api.config import get_settings
from codesage_api.extractors import process_metrics
from codesage_api.extractors.process_metrics import count_commits, extract_process_metrics


class _Repository:
    last_path: str | None = None
    last_kwargs: ClassVar[dict[str, object]] = {}

    def __init__(self, path: str, **kwargs: object) -> None:
        type(self).last_path = path
        type(self).last_kwargs = kwargs

    def traverse_commits(self):
        return _COMMITS


_ANCHOR = datetime(2026, 8, 1, tzinfo=UTC)
_COMMITS = [
    SimpleNamespace(
        hash="old",
        committer_date=_ANCHOR - timedelta(days=120),
        author=SimpleNamespace(email="old@example.com", name="Old"),
        modified_files=[
            SimpleNamespace(
                old_path=None,
                new_path="src/A.java",
                added_lines=0,
                deleted_lines=0,
            )
        ],
    ),
    SimpleNamespace(
        hash="recent-1",
        committer_date=_ANCHOR - timedelta(days=20),
        author=SimpleNamespace(email="one@example.com", name="One"),
        modified_files=[
            SimpleNamespace(
                old_path=None,
                new_path="src/A.java",
                added_lines=0,
                deleted_lines=0,
            )
        ],
    ),
    SimpleNamespace(
        hash="recent-2",
        committer_date=_ANCHOR - timedelta(days=5),
        author=SimpleNamespace(email="two@example.com", name="Two"),
        # PyDriller exposes platform-native separators for local repositories.
        modified_files=[
            SimpleNamespace(
                old_path=None,
                new_path=r"src\A.java",
                added_lines=0,
                deleted_lines=0,
            )
        ],
    ),
]


def test_process_window_is_anchored_to_scanned_commit(
    monkeypatch, tmp_path: Path, caplog
) -> None:
    source = tmp_path / "src" / "A.java"
    source.parent.mkdir()
    source.write_text("class A {}", encoding="utf-8")
    monkeypatch.setattr("codesage_api.extractors.process_metrics.Repository", _Repository)

    with caplog.at_level(logging.INFO):
        metrics = extract_process_metrics(tmp_path, "scanned-sha", _ANCHOR)

    assert _Repository.last_path == str(tmp_path)
    assert _Repository.last_kwargs == {"to_commit": "scanned-sha"}
    assert len(metrics) == 1
    assert metrics[0].path == "src/A.java"
    assert metrics[0].commits_90d == 2
    assert metrics[0].number_of_versions_until == 3
    assert metrics[0].number_of_authors_until == 3
    assert metrics[0].age_with_respect_to == 120 / 7
    summary = next(
        record for record in caplog.records if record.msg == "Repository history extraction completed"
    )
    assert summary.stage == "history-extraction"
    assert summary.commits_inspected == 3
    assert summary.files_measured == 1


def test_unmodified_checked_out_file_receives_zero_metrics(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "B.java").write_text("class B {}", encoding="utf-8")
    monkeypatch.setattr("codesage_api.extractors.process_metrics.Repository", _Repository)

    metrics = extract_process_metrics(tmp_path, "scanned-sha", _ANCHOR)

    assert metrics[0].commits_90d == 0
    assert metrics[0].number_of_versions_until == 0
    assert metrics[0].number_of_authors_until == 0
    assert metrics[0].age_with_respect_to == 0
    assert metrics[0].weighted_age_with_respect_to == 0


# ── Scan progress v2: commit counts while the history is read ─────────────────


def _history(length: int):
    """A Repository stand-in that walks `length` commits touching nothing."""
    commits = [
        SimpleNamespace(
            hash=f"c{index}",
            committer_date=_ANCHOR - timedelta(days=1),
            author=SimpleNamespace(email="dev@example.com", name="Dev"),
            modified_files=[],
        )
        for index in range(length)
    ]

    class _Walk:
        def __init__(self, path: str, **kwargs: object) -> None:
            pass

        def traverse_commits(self):
            return iter(commits)

    return _Walk


def _walk(monkeypatch, tmp_path: Path, length: int, total: int | None) -> list[tuple[int, int]]:
    (tmp_path / "A.java").write_text("class A {}", encoding="utf-8")
    monkeypatch.setattr(process_metrics, "Repository", _history(length))
    monkeypatch.setattr(process_metrics, "count_commits", lambda *_: total)
    heard: list[tuple[int, int]] = []
    extract_process_metrics(
        tmp_path, "scanned-sha", _ANCHOR, lambda done, of: heard.append((done, of))
    )
    return heard


def test_commit_counts_are_throttled_to_about_fifty_and_always_the_last(
    monkeypatch, tmp_path: Path
) -> None:
    heard = _walk(monkeypatch, tmp_path, length=1000, total=1000)

    assert len(heard) == process_metrics.COMMIT_REPORTS_PER_SCAN
    assert heard[0] == (20, 1000)
    assert heard[-1] == (1000, 1000)
    assert [done for done, _ in heard] == sorted({done for done, _ in heard})


def test_the_last_commit_is_reported_even_off_the_throttle_step(
    monkeypatch, tmp_path: Path
) -> None:
    heard = _walk(monkeypatch, tmp_path, length=103, total=103)

    # Every 2nd commit, plus 103 itself.
    assert [done for done, _ in heard] == [*range(2, 103, 2), 103]


def test_a_walk_that_ends_short_of_the_count_still_reports_where_it_stopped(
    monkeypatch, tmp_path: Path
) -> None:
    heard = _walk(monkeypatch, tmp_path, length=7, total=100)

    assert heard == [(2, 100), (4, 100), (6, 100), (7, 100)]


def test_a_tiny_history_reports_every_commit(monkeypatch, tmp_path: Path) -> None:
    assert _walk(monkeypatch, tmp_path, length=3, total=3) == [(1, 3), (2, 3), (3, 3)]


def test_an_uncounted_history_reports_nothing_and_still_measures(
    monkeypatch, tmp_path: Path
) -> None:
    (tmp_path / "A.java").write_text("class A {}", encoding="utf-8")
    monkeypatch.setattr(process_metrics, "Repository", _history(5))
    heard: list[tuple[int, int]] = []

    def fail(*_args, **_kwargs):
        raise subprocess.CalledProcessError(128, "git")

    monkeypatch.setattr(process_metrics.subprocess, "run", fail)

    metrics = extract_process_metrics(
        tmp_path, "scanned-sha", _ANCHOR, lambda done, of: heard.append((done, of))
    )

    assert heard == []
    assert [item.path for item in metrics] == ["A.java"]


def test_a_given_total_is_not_counted_again(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "A.java").write_text("class A {}", encoding="utf-8")
    monkeypatch.setattr(process_metrics, "Repository", _history(2))

    def must_not_count(*_args):
        raise AssertionError("counted twice")

    monkeypatch.setattr(process_metrics, "count_commits", must_not_count)
    heard: list[tuple[int, int]] = []

    extract_process_metrics(
        tmp_path,
        "scanned-sha",
        _ANCHOR,
        lambda done, of: heard.append((done, of)),
        commits_total=2,
    )

    assert heard == [(1, 2), (2, 2)]


def test_commits_are_counted_with_rev_list_under_the_git_time_limit(
    monkeypatch, tmp_path: Path
) -> None:
    seen: dict[str, object] = {}

    def run(args, **kwargs):
        seen["args"] = args
        seen["timeout"] = kwargs["timeout"]
        return SimpleNamespace(stdout="1212\n")

    monkeypatch.setattr(process_metrics.subprocess, "run", run)

    assert count_commits(tmp_path, "abc123") == 1212
    assert seen["args"] == ["git", "-C", str(tmp_path), "rev-list", "--count", "abc123"]
    assert seen["timeout"] == get_settings().git_timeout_seconds


@pytest.mark.parametrize(
    "failure",
    [
        subprocess.TimeoutExpired("git", 300),
        subprocess.CalledProcessError(128, "git"),
        FileNotFoundError("git"),
    ],
)
def test_a_failed_count_is_none_not_a_crash(
    monkeypatch, tmp_path: Path, failure: Exception
) -> None:
    def run(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(process_metrics.subprocess, "run", run)

    assert count_commits(tmp_path, "abc123") is None


def test_garbage_from_rev_list_is_none(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        process_metrics.subprocess, "run", lambda *_a, **_k: SimpleNamespace(stdout="fatal")
    )

    assert count_commits(tmp_path, "abc123") is None
