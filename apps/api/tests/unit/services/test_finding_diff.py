from types import SimpleNamespace

from codesage_api.services.finding_diff import diff_snapshots


def _snapshot(*fingerprints: str):
    findings = [SimpleNamespace(fingerprint=value) for value in fingerprints]
    location = SimpleNamespace(findings=findings)
    source_file = SimpleNamespace(source_locations=[location])
    return SimpleNamespace(source_files=[source_file])


def test_first_scan_marks_everything_new() -> None:
    result = diff_snapshots(_snapshot("a", "b"), None)
    assert result.new == {"a", "b"}
    assert result.unchanged == set()
    assert result.resolved == set()


def test_new_unchanged_and_resolved() -> None:
    result = diff_snapshots(_snapshot("same", "new"), _snapshot("same", "gone"))
    assert result.new == {"new"}
    assert result.unchanged == {"same"}
    assert result.resolved == {"gone"}


def test_identical_rescan_marks_everything_unchanged() -> None:
    result = diff_snapshots(_snapshot("a", "b"), _snapshot("a", "b"))
    assert result.new == set()
    assert result.unchanged == {"a", "b"}
    assert result.resolved == set()
