from pathlib import Path

from codesage_api.detection.rules.engine import detect
from codesage_api.detection.rules.registry import RuleDefinition
from codesage_api.extractors.ck_metrics import FileMetrics, MethodMetrics
from codesage_api.scoring.enums import Category, Severity


def _rules() -> list[RuleDefinition]:
    return [
        RuleDefinition("complex-function", Category.CODE_DESIGN, Severity.MEDIUM, "complex", 15),
        RuleDefinition("long-method", Category.CODE_DESIGN, Severity.MEDIUM, "long", 80),
        RuleDefinition("deep-nesting", Category.CODE_DESIGN, Severity.MEDIUM, "deep", 4),
        RuleDefinition("large-file", Category.CODE_DESIGN, Severity.LOW, "large", 800),
        RuleDefinition("hardcoded-secret", Category.SECURITY, Severity.CRITICAL, "Secret in {symbol}", 0),
        RuleDefinition("sql-concat", Category.SECURITY, Severity.HIGH, "SQL in {symbol}", 0),
    ]


def test_metric_and_security_rules_produce_traceable_findings(tmp_path: Path) -> None:
    source = tmp_path / "src" / "Example.java"
    source.parent.mkdir()
    source.write_text(
        'class Example {\n  String password = "not-a-real-secret";\n'
        '  String q = "SELECT * FROM users WHERE id=" + id;\n}\n',
        encoding="utf-8",
    )
    metrics = [
        FileMetrics(
            path="src/Example.java",
            loc=900,
            cyclomatic_complexity=20,
            max_nesting_depth=5,
            method_count=2,
            longest_method_lines=90,
        )
    ]

    methods = [MethodMetrics("src/Example.java", "Example", "work", 8, 90, 20, 5)]
    findings = detect(metrics, _rules(), tmp_path, methods)

    assert {item.rule_id for item in findings} == {
        "complex-function",
        "long-method",
        "deep-nesting",
        "large-file",
        "hardcoded-secret",
        "sql-concat",
    }
    assert all(item.file_path == "src/Example.java" for item in findings)
    assert all(len(item.fingerprint) == 64 for item in findings)
    method_findings = [item for item in findings if item.rule_id in {
        "complex-function", "long-method", "deep-nesting"
    }]
    assert all(item.line == 8 for item in method_findings)
    assert all(item.symbol == "Example.work" for item in method_findings)


def test_rules_do_not_emit_findings_below_thresholds(tmp_path: Path) -> None:
    (tmp_path / "Small.java").write_text("class Small {}", encoding="utf-8")
    metrics = [FileMetrics("Small.java", 10, 1, 0, 0, 0)]

    assert detect(metrics, _rules(), tmp_path) == []


def test_complexity_is_not_summed_across_methods(tmp_path: Path) -> None:
    (tmp_path / "Example.java").write_text("class Example {}", encoding="utf-8")
    files = [FileMetrics("Example.java", 20, 20, 1, 2, 10)]
    methods = [
        MethodMetrics("Example.java", "Example", "first", 2, 10, 10, 1),
        MethodMetrics("Example.java", "Example", "second", 20, 10, 10, 1),
    ]

    assert detect(files, _rules(), tmp_path, methods) == []
