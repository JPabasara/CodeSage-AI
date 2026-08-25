from pathlib import Path

from codesage_api.detection.rules.engine import detect
from codesage_api.detection.rules.registry import get_rules
from codesage_api.extractors.ck_metrics import FileMetrics


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

    findings = detect(metrics, list(get_rules()), tmp_path)

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


def test_rules_do_not_emit_findings_below_thresholds(tmp_path: Path) -> None:
    (tmp_path / "Small.java").write_text("class Small {}", encoding="utf-8")
    metrics = [FileMetrics("Small.java", 10, 1, 0, 0, 0)]

    assert detect(metrics, list(get_rules()), tmp_path) == []
