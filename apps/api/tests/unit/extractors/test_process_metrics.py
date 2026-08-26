from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar

from codesage_api.extractors.process_metrics import extract_process_metrics


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
        modified_files=[SimpleNamespace(new_path="src/A.java")],
    ),
    SimpleNamespace(
        hash="recent-1",
        committer_date=_ANCHOR - timedelta(days=20),
        author=SimpleNamespace(email="one@example.com", name="One"),
        modified_files=[SimpleNamespace(new_path="src/A.java")],
    ),
    SimpleNamespace(
        hash="recent-2",
        committer_date=_ANCHOR - timedelta(days=5),
        author=SimpleNamespace(email="two@example.com", name="Two"),
        # PyDriller exposes platform-native separators for local repositories.
        modified_files=[SimpleNamespace(new_path=r"src\A.java")],
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
    assert metrics[0].author_count == 3
    assert metrics[0].file_age_days == 120
    assert metrics[0].recency_days == 5
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
    assert metrics[0].author_count == 0
    assert metrics[0].file_age_days == 0
    assert metrics[0].recency_days == 0
