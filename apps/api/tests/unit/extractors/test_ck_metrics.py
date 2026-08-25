from __future__ import annotations

from pathlib import Path

from codesage_api.extractors.ck_metrics import (
    CKExtractionError,
    FileMetrics,
    extract_ck_metrics,
)


def test_ck_csv_is_aggregated_per_file(monkeypatch, tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    repository.mkdir()
    jar = tmp_path / "ck.jar"
    jar.touch()

    def fake_run(command, **kwargs):
        output = Path(command[-1])
        (output / "class.csv").write_text(
            "file,loc,wmc,maxNestedBlocksQty,totalMethodsQty\n"
            f"{repository / 'src/A.java'},40,7,2,3\n"
            f"{repository / 'src/A.java'},10,2,4,1\n",
            encoding="utf-8",
        )
        (output / "method.csv").write_text(
            "file,loc\n"
            f"{repository / 'src/A.java'},12\n"
            f"{repository / 'src/A.java'},18\n",
            encoding="utf-8",
        )

    monkeypatch.setattr("codesage_api.extractors.ck_metrics.subprocess.run", fake_run)

    assert extract_ck_metrics(repository, ck_jar=jar) == [
        FileMetrics("src/A.java", 50, 9.0, 4, 4, 18)
    ]


def test_missing_ck_jar_has_a_clear_failure(tmp_path: Path) -> None:
    try:
        extract_ck_metrics(tmp_path, ck_jar=tmp_path / "missing.jar")
    except CKExtractionError as exc:
        assert "CK jar was not found" in str(exc)
    else:
        raise AssertionError("missing CK jar was accepted")
