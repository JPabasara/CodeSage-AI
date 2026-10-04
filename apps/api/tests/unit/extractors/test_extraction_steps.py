"""`extract()` announces each sub-step of reading the code before it starts,
with the total its count will run to (scan progress v2)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from codesage_api.extractors import pipeline
from codesage_api.scoring.enums import ScanStep

_PIPELINE = "codesage_api.extractors.pipeline"
_DATE = datetime(2026, 8, 1, tzinfo=UTC)


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    (tmp_path / "src").mkdir()
    for name in ("A.java", "B.java"):
        (tmp_path / "src" / name).write_text("class X { // TODO: tidy\n}\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("not java", encoding="utf-8")
    return tmp_path


@pytest.fixture
def events(monkeypatch) -> list[tuple]:
    """One ordered log of the steps and the work they announce."""
    log: list[tuple] = []

    def ck(_path: Path) -> SimpleNamespace:
        log.append(("ck",))
        return SimpleNamespace(files=[], classes=[], methods=[])

    def history(_path, _sha, _date, on_commit=None, *, commits_total=None) -> list:
        log.append(("history", on_commit is not None, commits_total))
        return []

    monkeypatch.setattr(f"{_PIPELINE}.extract_ck_analysis", ck)
    monkeypatch.setattr(f"{_PIPELINE}.extract_process_metrics", history)
    monkeypatch.setattr(f"{_PIPELINE}.count_commits", lambda *_: 1212)
    return log


def _on_step(log: list[tuple]):
    def on_step(step, percent, *, files_total=None, commits_total=None) -> None:
        log.append(("step", step, percent, files_total, commits_total))

    return on_step


def test_the_steps_are_announced_in_order_before_their_work(
    repository: Path, events: list[tuple]
) -> None:
    pipeline.extract(
        repository,
        "a" * 40,
        _DATE,
        on_file=lambda done, total: events.append(("file", done, total)),
        on_step=_on_step(events),
        on_commit=Mock(),
    )

    assert events == [
        ("step", ScanStep.MEASURING_CODE, 25, None, None),
        ("ck",),
        ("step", ScanStep.READING_HISTORY, 37, None, 1212),
        ("history", True, 1212),
        ("step", ScanStep.READING_COMMENTS, 52, 2, None),
        ("file", 1, 2),
        ("file", 2, 2),
    ]


def test_an_uncounted_history_is_announced_without_a_total_and_reports_no_commits(
    repository: Path, events: list[tuple], monkeypatch
) -> None:
    monkeypatch.setattr(f"{_PIPELINE}.count_commits", lambda *_: None)

    pipeline.extract(repository, "a" * 40, _DATE, on_step=_on_step(events), on_commit=Mock())

    assert ("step", ScanStep.READING_HISTORY, 37, None, None) in events
    # No `on_commit` reaches the walk, so it neither counts again nor reports.
    assert ("history", False, None) in events


def test_without_progress_callbacks_the_history_is_not_counted(
    repository: Path, events: list[tuple], monkeypatch
) -> None:
    count = Mock(return_value=1212)
    monkeypatch.setattr(f"{_PIPELINE}.count_commits", count)

    pipeline.extract(repository, "a" * 40, _DATE)

    count.assert_not_called()
    assert events == [("ck",), ("history", False, None)]
