from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree

from codesage_api.detection.fingerprint import build
from codesage_api.detection.pmd.classpath import ClasspathProvider, NoTrustedClasspath
from codesage_api.detection.pmd.config import PMDConfig, load_config
from codesage_api.detection.pmd.java_version import detect_java_version
from codesage_api.detection.pmd.mapping import validate_mapping
from codesage_api.detection.pmd.models import (
    DetectorResult,
    DetectorStatus,
    Diagnostic,
    PMDViolation,
    ScanContext,
)
from codesage_api.detection.pmd.parser import PMDReportError, parse
from codesage_api.detection.pmd.runner import (
    PMDExecutableMissing,
    PMDRunError,
    PMDTimeout,
    run,
)
from codesage_api.detection.pmd.scope import iter_java_files
from codesage_api.detection.rules.engine import DetectedFinding
from codesage_api.scoring.enums import Category, Severity, Source

_SEVERITY_BY_PRIORITY = {
    1: Severity.HIGH,
    2: Severity.HIGH,
    3: Severity.MEDIUM,
    4: Severity.LOW,
    5: Severity.LOW,
}


def _qualified_class_name(violation: PMDViolation) -> str | None:
    if violation.class_name is None:
        return None
    if violation.package_name:
        return f"{violation.package_name}.{violation.class_name}"
    return violation.class_name


def _normalize(violation: PMDViolation, category: Category) -> DetectedFinding:
    rule_id = f"pmd:{violation.rule}"
    symbol = (
        violation.method_name
        or violation.class_name
        or violation.variable_name
        or Path(violation.file_path).stem
    )
    fingerprint = build(
        Source.RULE,
        rule_id=rule_id,
        file_path=violation.file_path,
        entity=symbol,
        line=str(violation.begin_line),
        column=str(violation.begin_column),
    )
    return DetectedFinding(
        file_path=violation.file_path,
        line=violation.begin_line,
        symbol=symbol,
        rule_id=rule_id,
        category=category,
        severity=_SEVERITY_BY_PRIORITY.get(violation.priority, Severity.LOW),
        description=violation.message,
        evidence=f"PMD {violation.ruleset}/{violation.rule} priority {violation.priority}",
        measured_value=None,
        threshold=None,
        fingerprint=fingerprint,
        class_name=_qualified_class_name(violation),
        method_name=violation.method_name,
        end_line=violation.end_line,
        begin_column=violation.begin_column,
        end_column=violation.end_column,
    )


def scan(
    repository_path: Path,
    scan_context: ScanContext | None = None,
    *,
    config: PMDConfig | None = None,
    classpath_provider: ClasspathProvider | None = None,
) -> DetectorResult:
    """Run the optional PMD stage through its single public boundary."""
    disabled = set(scan_context.disabled_rule_ids if scan_context else ())
    started = time.monotonic()
    configured = config or load_config()
    if not configured.enabled:
        return DetectorResult(
            status=DetectorStatus.SKIPPED,
            metadata={"detector": "pmd", "pmd_version": "7.27.0", "status": "skipped"},
        )
    if next(iter_java_files(repository_path), None) is None:
        return DetectorResult(
            status=DetectorStatus.SKIPPED,
            diagnostics=[Diagnostic("no_java_files", "Repository contains no Java files.")],
            metadata={
                "detector": "pmd",
                "pmd_version": "7.27.0",
                "status": "skipped",
                "files_analyzed": 0,
            },
        )
    java = detect_java_version(repository_path)
    classpath = (classpath_provider or NoTrustedClasspath()).resolve(repository_path)
    mode = "semantic" if classpath.available else "core"
    profile = "codesage.xml" if classpath.available else "codesage-core-profile.xml"
    configured = replace(
        configured,
        ruleset=configured.ruleset.with_name(profile),
        java_version=java.version,
        aux_classpath=classpath.entries,
    )
    mapping_path = configured.mapping or Path(__file__).with_name("rule_mapping.yaml")
    mapping = validate_mapping(configured.ruleset.parent, mapping_path)
    files_analyzed = sum(1 for _ in iter_java_files(repository_path))
    base_metadata: dict[str, object] = {
        "detector": "pmd",
        "pmd_version": "7.27.0",
        "analysis_mode": mode,
        "java_version": java.version or "unresolved",
        "java_version_source": java.source,
        "aux_classpath_available": classpath.available,
        "profile": profile,
        "files_analyzed": files_analyzed,
    }
    try:
        if any(rule_id.startswith("pmd:") for rule_id in disabled):
            with TemporaryDirectory(prefix="codesage-selected-rules-") as directory:
                selected_path = Path(directory) / "rules.xml"
                count = _write_selected_ruleset(configured.ruleset, selected_path, disabled)
                if count == 0:
                    return DetectorResult(
                        DetectorStatus.SKIPPED,
                        metadata={**base_metadata, "status": "skipped", "findings": 0},
                    )
                run_output = run(repository_path, replace(configured, ruleset=selected_path))
        else:
            run_output = run(repository_path, configured)
        violations = parse(run_output.report, repository_path)
    except PMDExecutableMissing as exc:
        return DetectorResult(
            DetectorStatus.DEGRADED,
            diagnostics=[Diagnostic("executable_missing", str(exc))],
            metadata={
                **base_metadata,
                "status": "degraded",
                "findings": 0,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
    except PMDTimeout as exc:
        return DetectorResult(
            DetectorStatus.DEGRADED,
            diagnostics=[Diagnostic("timeout", str(exc))],
            metadata={
                **base_metadata,
                "status": "degraded",
                "findings": 0,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
    except (PMDRunError, PMDReportError) as exc:
        return DetectorResult(
            DetectorStatus.DEGRADED,
            diagnostics=[Diagnostic("execution_failed", str(exc))],
            metadata={
                **base_metadata,
                "status": "degraded",
                "findings": 0,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
    findings = [
        _normalize(item, mapping[item.rule])
        for item in violations
        if f"pmd:{item.rule}" not in disabled
    ]
    partial = run_output.return_code != 0
    return DetectorResult(
        DetectorStatus.DEGRADED if partial else DetectorStatus.OK,
        findings=findings,
        diagnostics=[
            Diagnostic(
                "partial_report" if partial else "analysis_context",
                (
                    "PMD reported processing errors; valid findings from the "
                    "remaining files were preserved."
                    if partial
                    else (
                        "Semantic context available."
                        if classpath.available
                        else "No trusted classpath; core profile used."
                    )
                ),
            )
        ],
        metadata={
            "detector": "pmd",
            "pmd_version": "7.27.0",
            "status": "degraded" if partial else "ok",
            "return_code": run_output.return_code,
            "analysis_mode": mode,
            "java_version": java.version or "unresolved",
            "java_version_source": java.source,
            "aux_classpath_available": classpath.available,
            "profile": profile,
            "files_analyzed": sum(1 for _ in iter_java_files(repository_path)),
            "findings": len(findings),
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
    )


def _write_selected_ruleset(profile: Path, output: Path, disabled: set[str]) -> int:
    """Copy enabled rule references, including their existing properties/priority."""
    # PMD validates literal tag names, so its ruleset namespace must be unprefixed.
    ElementTree.register_namespace("", "http://pmd.sourceforge.net/ruleset/2.0.0")
    namespace = "{http://pmd.sourceforge.net/ruleset/2.0.0}"
    root = ElementTree.Element(namespace + "ruleset", {"name": "CodeSage workspace selection"})
    ElementTree.SubElement(root, namespace + "description").text = "Selected workspace rules."
    for reference in ElementTree.parse(profile).getroot().findall(namespace + "rule"):
        bundled = profile.parent / reference.attrib["ref"]
        for rule in ElementTree.parse(bundled).getroot().findall(namespace + "rule"):
            rule_id = "pmd:" + rule.attrib["ref"].rsplit("/", 1)[-1]
            if rule_id not in disabled:
                root.append(rule)
    ElementTree.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    return len(root.findall(namespace + "rule"))
