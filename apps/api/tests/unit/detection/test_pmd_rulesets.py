from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from codesage_api.detection.pmd.config import PMDConfig
from codesage_api.detection.pmd.detector import _normalize, scan
from codesage_api.detection.pmd.mapping import enabled_rules, validate_mapping
from codesage_api.detection.pmd.models import DetectorStatus, PMDViolation
from codesage_api.scoring.enums import Category, Severity

PROJECT_ROOT = Path(__file__).parents[5]
PMD_DIR = PROJECT_ROOT / "apps/api/src/codesage_api/detection/pmd"
FIXTURE_DIR = PROJECT_ROOT / "apps/api/tests/fixtures/pmd"


def _pmd_binary() -> Path | None:
    candidates = (
        PROJECT_ROOT / ".tmp/pmd-smoke/pmd-bin-7.27.0/bin/pmd",
        Path("/opt/pmd/bin/pmd"),
    )
    return next((path for path in candidates if path.is_file()), None)


def test_enabled_rules_and_mappings_are_exactly_one_to_one() -> None:
    rules = enabled_rules(PMD_DIR / "rulesets")
    mapping = validate_mapping(PMD_DIR / "rulesets", PMD_DIR / "rule_mapping.yaml")
    assert rules == mapping.keys()
    assert {mapping[rule] for rule in ("HardCodedCryptoKey", "InsecureCryptoIv")} == {
        Category.SECURITY
    }
    assert mapping["TestClassWithoutTestCases"] is Category.TEST
    assert mapping["BrokenNullCheck"] is Category.CODE_DESIGN


def test_allowlists_exclude_duplicate_and_low_value_rules() -> None:
    rules = enabled_rules(PMD_DIR / "rulesets")
    assert "SystemPrintln" not in rules
    assert "CyclomaticComplexity" not in rules
    assert "AvoidDeeplyNestedIfStmts" not in rules
    assert "NcssCount" not in rules
    assert not rules.intersection(
        {"ShortVariable", "LongVariable", "ModifierOrder", "UseDiamondOperator"}
    )


def test_no_deprecated_aliases_or_broad_rulesets_are_enabled() -> None:
    xml = "".join(path.read_text(encoding="utf-8") for path in (PMD_DIR / "rulesets").glob("*.xml"))
    assert "quickstart.xml" not in xml
    assert "category/java/codestyle.xml" not in xml
    assert "category/java/documentation.xml" not in xml
    assert "category/java/performance.xml" not in xml
    assert "category/java/design.xml/AvoidCatchingGenericException" not in xml


def test_priority_category_location_metadata_and_fingerprint_are_preserved() -> None:
    violation = PMDViolation(
        rule="BrokenNullCheck",
        ruleset="Error Prone",
        priority=2,
        message="broken",
        file_path="src/Main.java",
        begin_line=8,
        end_line=9,
        begin_column=4,
        end_column=17,
        package_name="example",
        class_name="Main",
        method_name="run",
        variable_name="value",
    )
    first = _normalize(violation, Category.CODE_DESIGN)
    second = _normalize(violation, Category.CODE_DESIGN)
    assert first.severity is Severity.HIGH
    assert first.category is Category.CODE_DESIGN
    assert (first.line, first.end_line, first.begin_column, first.end_column) == (8, 9, 4, 17)
    assert (first.class_name, first.method_name) == ("example.Main", "run")
    assert first.fingerprint == second.fingerprint


def test_real_pmd_727_detects_required_fixture_without_duplicates(tmp_path: Path) -> None:
    binary = _pmd_binary()
    if binary is None:
        pytest.skip("PMD 7.27.0 is not installed in this test environment")
    repository = tmp_path / "repository"
    shutil.copytree(FIXTURE_DIR, repository)
    result = scan(
        repository,
        config=PMDConfig(
            True,
            binary,
            30.0,
            PMD_DIR / "rulesets" / "codesage.xml",
            PMD_DIR / "rule_mapping.yaml",
        ),
    )
    assert result.status is DetectorStatus.OK
    rules = [finding.rule_id for finding in result.findings]
    required = {
        "pmd:BrokenNullCheck",
        "pmd:EmptyCatchBlock",
        "pmd:UseEqualsToCompareStrings",
        "pmd:UnusedLocalVariable",
        "pmd:TestClassWithoutTestCases",
        "pmd:HardCodedCryptoKey",
        "pmd:CognitiveComplexity",
    }
    assert required.issubset(rules)
    assert "pmd:SystemPrintln" not in rules
    assert "pmd:CyclomaticComplexity" not in rules
    assert len(result.findings) == len({finding.fingerprint for finding in result.findings})


def test_repository_scope_excludes_build_outputs_but_keeps_tests(tmp_path: Path) -> None:
    from codesage_api.detection.pmd.scope import iter_java_files

    included = tmp_path / "src" / "test" / "java" / "ExampleTest.java"
    excluded = tmp_path / "target" / "generated-sources" / "Generated.java"
    included.parent.mkdir(parents=True)
    excluded.parent.mkdir(parents=True)
    included.touch()
    excluded.touch()
    assert list(iter_java_files(tmp_path)) == [included]
