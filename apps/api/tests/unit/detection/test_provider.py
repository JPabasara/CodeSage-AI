from pathlib import Path

from codesage_api.detection.provider import (
    DetectorResult,
    DetectorStatus,
    ScanContext,
    load_detector,
    run_optional_detector,
)


def test_configured_provider_is_loaded_without_core_tool_knowledge() -> None:
    detector = load_detector("codesage_api.detection.pmd:scan")
    assert callable(detector)


def test_no_provider_skips_the_optional_stage(tmp_path: Path) -> None:
    result = run_optional_detector(tmp_path, provider="")
    assert result.status is DetectorStatus.SKIPPED
    assert result.findings == []


def test_broken_provider_degrades_instead_of_failing_the_scan(tmp_path: Path) -> None:
    result = run_optional_detector(
        tmp_path,
        ScanContext(attempt_id="attempt-1"),
        provider="codesage_api.detection.missing:scan",
    )
    assert result.status is DetectorStatus.DEGRADED
    assert result.findings == []
    assert [item.code for item in result.diagnostics] == ["provider_failed"]


def test_provider_result_contract_is_tool_neutral() -> None:
    result = DetectorResult(DetectorStatus.OK, metadata={"detector": "replacement"})
    assert result.metadata["detector"] == "replacement"
