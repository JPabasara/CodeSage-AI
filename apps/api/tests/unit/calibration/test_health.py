from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from codesage_api.calibration.health import (
    bootstrap_interval,
    calibrate,
    load_observations,
    markdown_report,
    parse_observation,
    percentile,
    write_outputs,
)


def observation(repo: str, density: float, *, kloc: float = 10.0):
    return parse_observation(
        {
            "repository_id": repo,
            "commit_sha": f"sha-{repo}",
            "status": "ready",
            "debt_score": density * kloc,
            "kloc": kloc,
            "provenance": {"engine": "test"},
            "counts": {
                "severity": {"high": 1},
                "category": {"code-design": 1},
                "source": {"rule": 1},
            },
        }
    )


def test_percentile_uses_r7_linear_interpolation() -> None:
    values = [1.0, 2.0, 3.0, 4.0]
    assert percentile(values, 25) == pytest.approx(1.75)
    assert percentile(values, 95) == pytest.approx(3.85)


def test_p95_is_selected_and_alternatives_are_reported() -> None:
    items = [observation(str(index), float(index)) for index in range(1, 21)]
    result = calibrate(items, "manifest", bootstrap_samples=50, seed=3)
    assert result["selected_k"] == pytest.approx(percentile(list(range(1, 21)), 95))
    assert result["sensitivity"]["p90"] == pytest.approx(18.1)
    assert result["sensitivity"]["p99"] == pytest.approx(19.81)


@pytest.mark.parametrize(
    ("record", "reason"),
    [
        ({"repository_id": "zero", "debt_score": 1, "kloc": 0}, "invalid_or_zero_kloc"),
        ({"repository_id": "missing", "debt_score": 1}, "invalid_or_zero_kloc"),
        ({"repository_id": "failed", "debt_score": 1, "kloc": 1, "status": "error"}, "incomplete_scan"),
    ],
)
def test_invalid_and_incomplete_records_are_excluded(record, reason: str) -> None:
    item = parse_observation(record)
    assert item.excluded
    assert reason in item.exclusion_reasons


def test_small_dataset_is_supported_and_warned() -> None:
    result = calibrate([observation("only", 4.0)], "manifest", bootstrap_samples=10)
    assert result["selected_k"] == 4.0
    assert any("Small calibration corpus" in warning for warning in result["warnings"])


def test_extreme_outlier_is_retained_and_flagged() -> None:
    items = [observation(str(index), 1.0) for index in range(8)]
    extreme = observation("extreme", 100.0)
    items.append(extreme)
    result = calibrate(items, "manifest", bootstrap_samples=20)
    assert not extreme.excluded
    assert extreme.iqr_outlier
    assert "high_iqr_outlier" in extreme.flags
    assert result["dataset"]["eligible_repositories"] == 9


def test_bootstrap_is_reproducible_with_fixed_seed() -> None:
    values = [1.0, 2.0, 4.0, 8.0]
    assert bootstrap_interval(values, samples=100, seed=9) == bootstrap_interval(
        values, samples=100, seed=9
    )


def test_mad_flag_is_calculated() -> None:
    items = [observation(str(index), value) for index, value in enumerate([1, 2, 3, 4, 100])]
    calibrate(items, "manifest", bootstrap_samples=10)
    assert items[-1].mad_outlier_score is not None
    assert items[-1].mad_outlier_score > 3.5
    assert "high_mad_outlier" in items[-1].flags


def test_duplicate_repository_records_are_excluded(tmp_path: Path) -> None:
    source = tmp_path / "scans.json"
    source.write_text(
        json.dumps(
            [
                {"repository_id": "same", "debt_score": 1, "kloc": 1},
                {"repository_id": "same", "debt_score": 2, "kloc": 1},
            ]
        ),
        encoding="utf-8",
    )
    items, manifest = load_observations(source)
    assert len(manifest) == 64
    assert all(item.excluded for item in items)
    assert all("duplicate_repository_observation" in item.exclusion_reasons for item in items)


def test_outputs_include_json_csv_markdown_and_provenance(tmp_path: Path) -> None:
    items = [observation("alpha", 1.0), observation("beta", 5.0)]
    result = calibrate(items, "abc", bootstrap_samples=10)
    write_outputs(tmp_path, result, items)

    parsed = json.loads((tmp_path / "calibration.json").read_text(encoding="utf-8"))
    local = parsed["configuration"]["calibration_tool_local_reference"]
    assert local["loc"]["method"]
    assert local["health_scope"]["generated"] == "excluded from both debt and LOC"
    assert local["profile_id"] == "health-scoring-profile-v1"
    assert parsed["configuration"]["scan_provenance_records"] == [{"engine": "test"}]
    with (tmp_path / "repositories.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["severity_counts"] == '{"high": 1}'
    report = (tmp_path / "calibration.md").read_text(encoding="utf-8")
    assert "Selected calibration" in report
    assert "Scoring configuration and provenance" in report
    assert report == markdown_report(result, items)


def test_run_specific_provenance_does_not_trigger_mixed_configuration_warning() -> None:
    left = observation("left", 1.0)
    right = observation("right", 2.0)
    left.provenance.update({"branch": "main", "snapshot_id": "one", "scanned_at": "now"})
    right.provenance.update({"branch": "master", "snapshot_id": "two", "scanned_at": "later"})

    result = calibrate([left, right], "manifest", bootstrap_samples=10)

    assert not any("differing provenance" in warning for warning in result["warnings"])
    assert result["configuration"]["scan_provenance_records"] == [{"engine": "test"}]
