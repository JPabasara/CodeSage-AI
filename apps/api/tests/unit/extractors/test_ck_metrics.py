from __future__ import annotations

import os
from pathlib import Path

from codesage_api.extractors.ck_metrics import (
    CKExtractionError,
    FileMetrics,
    MethodMetrics,
    extract_ck_analysis,
    extract_ck_metrics,
)


def test_ck_csv_is_aggregated_per_file(monkeypatch, tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    repository.mkdir()
    jar = tmp_path / "ck.jar"
    jar.touch()

    def fake_run(command, **kwargs):
        assert command[-1].endswith(os.sep)
        output = Path(command[-1])
        (output / "class.csv").write_text(
            "file,loc,wmc,maxNestedBlocksQty,totalMethodsQty\n"
            f"{repository / 'src/A.java'},40,7,2,3\n"
            f"{repository / 'src/A.java'},10,2,4,1\n",
            encoding="utf-8",
        )
        (output / "method.csv").write_text(
            "file,class,method,line,loc,wmc,maxNestedBlocksQty\n"
            f"{repository / 'src/A.java'},A,small,5,12,2,1\n"
            f"{repository / 'src/A.java'},A,large,30,18,7,3\n",
            encoding="utf-8",
        )

    monkeypatch.setattr("codesage_api.extractors.ck_metrics.subprocess.run", fake_run)

    assert extract_ck_metrics(repository, ck_jar=jar) == [
        FileMetrics("src/A.java", 50, 9.0, 4, 4, 18)
    ]


def test_ck_method_rows_are_preserved_for_method_rules(monkeypatch, tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    repository.mkdir()
    jar = tmp_path / "ck.jar"
    jar.touch()

    def fake_run(command, **kwargs):
        output = Path(command[-1])
        (output / "class.csv").write_text(
            "file,loc,wmc,maxNestedBlocksQty,totalMethodsQty\n"
            f"{repository / 'A.java'},20,5,2,1\n",
            encoding="utf-8",
        )
        (output / "method.csv").write_text(
            "file,class,method,line,loc,wmc,maxNestedBlocksQty\n"
            f"{repository / 'A.java'},A,work,7,12,4,2\n",
            encoding="utf-8",
        )

    monkeypatch.setattr("codesage_api.extractors.ck_metrics.subprocess.run", fake_run)

    assert extract_ck_analysis(repository, ck_jar=jar).methods == [
        MethodMetrics("A.java", "A", "work", 7, 12, 4.0, 2)
    ]


def test_missing_ck_jar_has_a_clear_failure(tmp_path: Path) -> None:
    try:
        extract_ck_metrics(tmp_path, ck_jar=tmp_path / "missing.jar")
    except CKExtractionError as exc:
        assert "CK jar was not found" in str(exc)
    else:
        raise AssertionError("missing CK jar was accepted")
