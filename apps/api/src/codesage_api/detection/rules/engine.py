from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from codesage_api.detection.fingerprint import rule_fingerprint
from codesage_api.detection.reasons import render_rule_reason
from codesage_api.detection.rules.registry import RuleDefinition
from codesage_api.detection.rules.security_rules import (
    detect_hardcoded_secret,
    detect_sql_concat,
)
from codesage_api.extractors.ck_metrics import FileMetrics, MethodMetrics
from codesage_api.scoring.enums import Category, Severity


@dataclass(frozen=True, slots=True)
class DetectedFinding:
    file_path: str
    line: int
    symbol: str
    rule_id: str
    category: Category
    severity: Severity
    description: str
    evidence: str | None
    measured_value: float | None
    threshold: float | None
    fingerprint: str


_FILE_RULE_ACCESSORS: dict[str, Callable[[FileMetrics], float]] = {
    "large-file": lambda item: float(item.loc),
}
_METHOD_RULE_ACCESSORS: dict[str, Callable[[MethodMetrics], float]] = {
    "complex-function": lambda item: item.cyclomatic_complexity,
    "long-method": lambda item: float(item.loc),
    "deep-nesting": lambda item: float(item.max_nesting_depth),
}
def _metric_findings(
    files: list[FileMetrics], rules: list[RuleDefinition]
) -> list[DetectedFinding]:
    findings: list[DetectedFinding] = []
    for item in files:
        symbol = Path(item.path).stem
        for rule in rules:
            accessor = _FILE_RULE_ACCESSORS.get(rule.rule_id)
            if accessor is None:
                continue
            value = accessor(item)
            threshold = rule.threshold
            if value <= threshold:
                continue
            findings.append(
                DetectedFinding(
                    file_path=item.path,
                    line=1,
                    symbol=symbol,
                    rule_id=rule.rule_id,
                    category=rule.category,
                    severity=rule.severity,
                    description=render_rule_reason(
                        rule.message_template,
                        symbol=symbol,
                        file=item.path,
                        value=value,
                        threshold=threshold,
                    ),
                    evidence=f"{rule.rule_id}={value:g}",
                    measured_value=value,
                    threshold=threshold,
                    fingerprint=rule_fingerprint(rule.rule_id, item.path, symbol),
                )
            )
    return findings


def _method_metric_findings(
    methods: list[MethodMetrics], rules: list[RuleDefinition]
) -> list[DetectedFinding]:
    findings: list[DetectedFinding] = []
    for item in methods:
        symbol = f"{item.class_name}.{item.method_name}"
        for rule in rules:
            accessor = _METHOD_RULE_ACCESSORS.get(rule.rule_id)
            if accessor is None:
                continue
            value = accessor(item)
            threshold = rule.threshold
            if value <= threshold:
                continue
            findings.append(
                DetectedFinding(
                    file_path=item.path,
                    line=item.line,
                    symbol=symbol,
                    rule_id=rule.rule_id,
                    category=rule.category,
                    severity=rule.severity,
                    description=render_rule_reason(
                        rule.message_template,
                        symbol=symbol,
                        file=item.path,
                        value=value,
                        threshold=threshold,
                    ),
                    evidence=f"{rule.rule_id}={value:g}",
                    measured_value=value,
                    threshold=threshold,
                    fingerprint=rule_fingerprint(rule.rule_id, item.path, symbol),
                )
            )
    return findings


def _pattern_findings(
    repository_path: Path, rules: list[RuleDefinition]
) -> list[DetectedFinding]:
    by_id = {rule.rule_id: rule for rule in rules}
    findings: list[DetectedFinding] = []
    for path in sorted(repository_path.rglob("*.java")):
        if ".git" in path.parts:
            continue
        relative = path.relative_to(repository_path).as_posix()
        source = path.read_text(encoding="utf-8", errors="replace")
        detectors = (
            ("hardcoded-secret", detect_hardcoded_secret),
            ("sql-concat", detect_sql_concat),
        )
        for rule_id, detector in detectors:
            rule = by_id.get(rule_id)
            if rule is None:
                continue
            for match in detector(path, source):
                findings.append(
                    DetectedFinding(
                        file_path=relative,
                        line=match.line,
                        symbol=match.symbol,
                        rule_id=rule.rule_id,
                        category=rule.category,
                        severity=rule.severity,
                        description=rule.message_template.format(symbol=match.symbol),
                        evidence=match.evidence,
                        measured_value=match.measured_value,
                        threshold=match.threshold,
                        fingerprint=rule_fingerprint(rule.rule_id, relative, match.symbol),
                    )
                )
    return findings


def detect(
    files: list[FileMetrics],
    rules: list[RuleDefinition],
    repository_path: Path,
    methods: list[MethodMetrics] | None = None,
) -> list[DetectedFinding]:
    return (
        _metric_findings(files, rules)
        + _method_metric_findings(methods or [], rules)
        + _pattern_findings(repository_path, rules)
    )
