"""Calibrate the repository-health debt-density constant from scan exports.

Input is a JSON file, or a directory of JSON files.  A file may contain one
record, a list of records, or ``{"records": [...]}``.  The required logical
fields are a repository identifier, total debt, and either LOC or KLOC.  The
loader accepts the names emitted by CodeSage's score cache (``debt_score`` and
``kloc``) as well as the explicit names shown below::

    {
      "repository_id": "owner/repository",
      "commit_sha": "...",
      "status": "ready",
      "total_weighted_debt": 42.5,
      "analyzed_loc": 12000,
      "counts": {"severity": {"high": 2}, "category": {}, "source": {}},
      "provenance": {"analysis_engine_version": "..."}
    }

Percentiles use Hyndman-Fan type 7 (NumPy's ``method="linear"``): for sorted
values, h=(n-1)q and the result linearly interpolates values floor(h), ceil(h).
Each repository is one observation.  Explicitly incomplete/invalid records and
all members of a duplicate-repository group are excluded; valid extremes remain
eligible and are only flagged for review.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import json
import math
import random
import subprocess
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from codesage_api.scoring.config_loader import get_presets
from codesage_api.scoring.models import Profile
from codesage_api.scoring.provenance import health_scoring_profile

PERCENTILES = (5.0, 10.0, 25.0, 50.0, 75.0, 90.0, 95.0, 97.5, 99.0)
COMPLETE_STATUSES = {"ready", "done", "complete", "completed"}
RUN_SPECIFIC_PROVENANCE_FIELDS = {"branch", "scanned_at", "snapshot_id"}


@dataclass(slots=True)
class RepositoryObservation:
    repository_id: str
    commit_sha: str | None
    analyzed_loc: float
    kloc: float
    total_weighted_debt: float
    debt_density: float
    status: str | None
    counts: dict[str, dict[str, int]] = field(default_factory=dict)
    provenance: dict[str, object] = field(default_factory=dict)
    source_file: str = ""
    flags: list[str] = field(default_factory=list)
    excluded: bool = False
    exclusion_reasons: list[str] = field(default_factory=list)
    iqr_outlier: bool = False
    mad_outlier_score: float | None = None


def percentile(values: Sequence[float], percent: float) -> float:
    """Return a type-7/R7 linearly interpolated percentile."""
    if not values:
        raise ValueError("percentile requires at least one value")
    if not 0.0 <= percent <= 100.0:
        raise ValueError("percent must be between 0 and 100")
    ordered = sorted(float(value) for value in values)
    position = (len(ordered) - 1) * percent / 100.0
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + fraction * (ordered[upper] - ordered[lower])


def _number(record: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = record.get(name)
        if value is not None and not isinstance(value, bool):
            try:
                result = float(value)
            except (TypeError, ValueError):
                return None
            return result if math.isfinite(result) else None
    return None


def _counts(record: dict[str, Any]) -> dict[str, dict[str, int]]:
    raw = record.get("counts", {})
    output: dict[str, dict[str, int]] = {}
    if isinstance(raw, dict):
        for group in ("severity", "category", "source"):
            values = raw.get(group, {})
            if isinstance(values, dict):
                output[group] = {
                    str(key): int(value)
                    for key, value in values.items()
                    if isinstance(value, (int, float)) and not isinstance(value, bool)
                }
    payload = record.get("result_payload")
    if "category" not in output and isinstance(payload, dict):
        breakdown = payload.get("category_breakdown")
        if isinstance(breakdown, list):
            output["category"] = {
                str(item["category"]): int(item["count"])
                for item in breakdown
                if isinstance(item, dict) and "category" in item and "count" in item
            }
    return output


def parse_observation(record: dict[str, Any], source_file: str = "") -> RepositoryObservation:
    repository_id = str(
        record.get("repository_id") or record.get("repo_id") or record.get("repository") or ""
    ).strip()
    debt = _number(record, "total_weighted_debt", "debt_score", "total_debt")
    kloc = _number(record, "kloc", "analyzed_kloc")
    loc = _number(record, "analyzed_loc", "loc")
    if kloc is None and loc is not None:
        kloc = loc / 1000.0
    if loc is None and kloc is not None:
        loc = kloc * 1000.0
    status_value = record.get("status")
    status = str(status_value).lower() if status_value is not None else None
    raw_provenance = record.get("provenance")
    provenance: dict[str, object] = (
        dict(raw_provenance) if isinstance(raw_provenance, dict) else {}
    )
    observation = RepositoryObservation(
        repository_id=repository_id,
        commit_sha=(str(record["commit_sha"]) if record.get("commit_sha") else None),
        analyzed_loc=loc if loc is not None else 0.0,
        kloc=kloc if kloc is not None else 0.0,
        total_weighted_debt=debt if debt is not None else 0.0,
        debt_density=(debt / kloc if debt is not None and kloc is not None and kloc > 0 else 0.0),
        status=status,
        counts=_counts(record),
        provenance=provenance,
        source_file=source_file,
    )
    if not repository_id:
        observation.exclusion_reasons.append("missing_repository_id")
    if debt is None or debt < 0:
        observation.exclusion_reasons.append("invalid_total_weighted_debt")
    if kloc is None or kloc <= 0:
        observation.exclusion_reasons.append("invalid_or_zero_kloc")
    if status is not None and status not in COMPLETE_STATUSES:
        observation.exclusion_reasons.append("incomplete_scan")
    if status is None:
        observation.flags.append("missing_scan_status")
    explicit_loc = _number(record, "analyzed_loc", "loc")
    explicit_kloc = _number(record, "kloc", "analyzed_kloc")
    if (
        explicit_loc is not None
        and explicit_kloc is not None
        and not math.isclose(explicit_loc / 1000.0, explicit_kloc, rel_tol=1e-6, abs_tol=1e-9)
    ):
        observation.flags.append("loc_kloc_mismatch")
    if not observation.commit_sha:
        observation.flags.append("missing_commit_sha")
    if not observation.provenance:
        observation.flags.append("missing_scan_provenance")
    observation.excluded = bool(observation.exclusion_reasons)
    return observation


def _json_records(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        data = data["records"]
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list) and all(isinstance(item, dict) for item in data):
        return data
    raise ValueError(f"{path}: expected a JSON object, list, or records list")


def load_observations(input_path: Path) -> tuple[list[RepositoryObservation], str]:
    paths = [input_path] if input_path.is_file() else sorted(input_path.rglob("*.json"))
    if not paths:
        raise ValueError(f"No JSON files found at {input_path}")
    observations: list[RepositoryObservation] = []
    manifest = hashlib.sha256()
    for path in paths:
        content = path.read_bytes()
        manifest.update(path.name.encode("utf-8"))
        manifest.update(b"\0")
        manifest.update(content)
        for raw in _json_records(path):
            observations.append(parse_observation(raw, str(path)))

    counts = Counter(item.repository_id for item in observations if item.repository_id)
    for item in observations:
        if item.repository_id and counts[item.repository_id] > 1:
            item.exclusion_reasons.append("duplicate_repository_observation")
            item.excluded = True
    return observations, manifest.hexdigest()


def _rank(values: Sequence[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda pair: pair[1])
    ranks = [0.0] * len(values)
    index = 0
    while index < len(indexed):
        end = index + 1
        while end < len(indexed) and indexed[end][1] == indexed[index][1]:
            end += 1
        rank = (index + 1 + end) / 2.0
        for position in range(index, end):
            ranks[indexed[position][0]] = rank
        index = end
    return ranks


def _pearson(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) < 2:
        return None
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    denominator = math.sqrt(
        sum((x - left_mean) ** 2 for x in left)
        * sum((y - right_mean) ** 2 for y in right)
    )
    return numerator / denominator if denominator else None


def spearman(values: Sequence[float], sizes: Sequence[float]) -> tuple[float | None, float | None]:
    coefficient = _pearson(_rank(values), _rank(sizes))
    p_value: float | None = None
    if coefficient is not None:
        try:
            stats = importlib.import_module("scipy.stats")
            result = stats.spearmanr(values, sizes)
            coefficient = float(result.statistic)
            p_value = float(result.pvalue)
        except (ImportError, AttributeError, TypeError, ValueError):
            pass
    return coefficient, p_value


def _comparable_provenance(provenance: dict[str, object]) -> dict[str, object]:
    """Remove scan identity fields that are expected to differ per repository."""
    return {
        key: value
        for key, value in provenance.items()
        if key not in RUN_SPECIFIC_PROVENANCE_FIELDS
    }


def bootstrap_interval(
    values: Sequence[float],
    percent: float = 95.0,
    samples: int = 10_000,
    seed: int = 42,
) -> tuple[float, float]:
    if samples <= 0:
        raise ValueError("bootstrap samples must be positive")
    if not values:
        raise ValueError("bootstrap requires at least one value")
    generator = random.Random(seed)
    estimates = [
        percentile([generator.choice(values) for _ in values], percent)
        for _ in range(samples)
    ]
    return percentile(estimates, 2.5), percentile(estimates, 97.5)


def _sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def configuration_provenance() -> dict[str, object]:
    balanced = get_presets()["balanced"]
    profile = Profile(weights=balanced.weights, s=balanced.s, name=balanced.name)
    package = Path(__file__).parents[1]
    config_dir = package / "scoring" / "config"
    try:
        git_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=package,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        git_commit = None
    local = health_scoring_profile(profile)
    local.update({
        "codesage_git_commit": git_commit,
        "config_hashes": {
            path.name: _sha256(path)
            for path in sorted(config_dir.glob("*.yaml"))
        },
        "pmd": {
            "ruleset": "codesage_api/detection/pmd/rulesets/codesage.xml",
            "ruleset_sha256": _sha256(package / "detection/pmd/rulesets/codesage.xml"),
            "mapping_sha256": _sha256(package / "detection/pmd/rule_mapping.yaml"),
            "version": "recorded per scan in analysis_engine_version.tool_versions when exported",
        },
    })
    return local


def calibrate(
    observations: list[RepositoryObservation],
    manifest_hash: str,
    selected_percentile: float = 95.0,
    bootstrap_samples: int = 10_000,
    seed: int = 42,
) -> dict[str, Any]:
    eligible = [item for item in observations if not item.excluded]
    if not eligible:
        raise ValueError("No eligible repository observations remain after validation")
    densities = [item.debt_density for item in eligible]
    q1 = percentile(densities, 25)
    q3 = percentile(densities, 75)
    iqr = q3 - q1
    iqr_limit = q3 + 1.5 * iqr
    median = percentile(densities, 50)
    deviations = [abs(value - median) for value in densities]
    mad = percentile(deviations, 50)
    for item in eligible:
        item.iqr_outlier = item.debt_density > iqr_limit
        if item.iqr_outlier:
            item.flags.append("high_iqr_outlier")
        if mad == 0:
            item.mad_outlier_score = 0.0 if item.debt_density == median else None
            if item.debt_density != median:
                item.flags.append("mad_zero_nonmedian")
        else:
            item.mad_outlier_score = 0.6744897501960817 * (item.debt_density - median) / mad
            if abs(item.mad_outlier_score) > 3.5:
                item.flags.append("high_mad_outlier")

    stats = {f"p{value:g}": percentile(densities, value) for value in PERCENTILES}
    stats.update({"min": min(densities), "max": max(densities), "iqr": iqr, "mad": mad})
    selected_k = percentile(densities, selected_percentile)
    ci_low, ci_high = bootstrap_interval(
        densities, selected_percentile, bootstrap_samples, seed
    )
    rho, p_value = spearman(densities, [item.kloc for item in eligible])
    warnings: list[str] = []
    if len(eligible) < 20:
        warnings.append("Small calibration corpus: tail percentiles and bootstrap CI are unstable.")
    if rho is not None and abs(rho) >= 0.3:
        warnings.append(
            "Debt density retains a substantial size relationship (documented review threshold: "
            "|Spearman rho| >= 0.30); inspect scope and normalization before adopting k."
        )
    provenance_configurations = {
        json.dumps(_comparable_provenance(item.provenance), sort_keys=True, default=str)
        for item in eligible
    }
    scan_provenance_records = [
        json.loads(value) for value in sorted(provenance_configurations) if value != "{}"
    ]
    if len(provenance_configurations) > 1:
        warnings.append("Eligible scans contain differing provenance/configuration records.")
        for item in eligible:
            item.flags.append("mixed_scan_provenance")
    if any("missing_scan_provenance" in item.flags for item in eligible):
        warnings.append("Some eligible scans are missing scan-level provenance.")

    return {
        "calibration_timestamp": datetime.now(UTC).isoformat(),
        "method": {
            "selected_rule": f"P{selected_percentile:g}(D/KLOC)",
            "selected_percentile": selected_percentile,
            "percentile_algorithm": "Hyndman-Fan type 7 / NumPy method='linear' equivalent",
            "bootstrap": {
                "level": 0.95,
                "samples": bootstrap_samples,
                "seed": seed,
                "resampling_unit": "repository",
            },
            "outlier_policy": "valid extremes retained and flagged; invalid records excluded",
        },
        "dataset": {
            "input_records": len(observations),
            "eligible_repositories": len(eligible),
            "excluded_records": len(observations) - len(eligible),
            "repository_manifest_sha256": manifest_hash,
            "exclusion_counts": dict(
                Counter(reason for item in observations for reason in item.exclusion_reasons)
            ),
        },
        "summary_statistics": stats,
        "selected_k": selected_k,
        "bootstrap_95_ci": {"low": ci_low, "high": ci_high},
        "sensitivity": {
            "p90": percentile(densities, 90),
            "p95": percentile(densities, 95),
            "p97.5": percentile(densities, 97.5),
            "p99": percentile(densities, 99),
            "max": max(densities),
        },
        "outlier_diagnostics": {
            "iqr_upper_fence": iqr_limit,
            "iqr_flag_count": sum(item.iqr_outlier for item in eligible),
            "mad_score_definition": "0.67448975 * (x - median) / MAD; review when |score| > 3.5",
        },
        "size_normalization": {
            "spearman_rho": rho,
            "p_value": p_value,
            "p_value_note": None if p_value is not None else "SciPy unavailable or statistic undefined",
            "review_threshold": "|rho| >= 0.30 (diagnostic warning, not pass/fail)",
        },
        "configuration": {
            "calibration_tool_local_reference": configuration_provenance(),
            "scan_provenance_records": scan_provenance_records,
            "interpretation": (
                "scan_provenance_records contains comparable imported scan configuration "
                "with branch, scanned_at, and snapshot_id removed; the local reference "
                "documents the tool installation that generated this report"
            ),
        },
        "warnings": warnings,
    }


def _json_safe(value: object) -> object:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def write_outputs(
    output_dir: Path,
    result: dict[str, Any],
    observations: Sequence[RepositoryObservation],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_result = _json_safe(result)
    (output_dir / "calibration.json").write_text(
        json.dumps(safe_result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    with (output_dir / "repositories.csv").open("w", encoding="utf-8", newline="") as handle:
        fields = [
            "repository_id", "commit_sha", "analyzed_loc", "kloc",
            "total_weighted_debt", "debt_density", "status", "excluded",
            "exclusion_reasons", "flags", "iqr_outlier", "mad_outlier_score",
            "severity_counts", "category_counts", "source_counts", "source_file",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in sorted(observations, key=lambda value: value.debt_density, reverse=True):
            writer.writerow({
                "repository_id": item.repository_id,
                "commit_sha": item.commit_sha or "",
                "analyzed_loc": item.analyzed_loc,
                "kloc": item.kloc,
                "total_weighted_debt": item.total_weighted_debt,
                "debt_density": item.debt_density,
                "status": item.status or "",
                "excluded": item.excluded,
                "exclusion_reasons": ";".join(item.exclusion_reasons),
                "flags": ";".join(item.flags),
                "iqr_outlier": item.iqr_outlier,
                "mad_outlier_score": item.mad_outlier_score,
                "severity_counts": json.dumps(item.counts.get("severity", {}), sort_keys=True),
                "category_counts": json.dumps(item.counts.get("category", {}), sort_keys=True),
                "source_counts": json.dumps(item.counts.get("source", {}), sort_keys=True),
                "source_file": item.source_file,
            })
    (output_dir / "calibration.md").write_text(
        markdown_report(result, observations), encoding="utf-8"
    )


def markdown_report(
    result: dict[str, Any], observations: Sequence[RepositoryObservation]
) -> str:
    dataset = result["dataset"]
    stats = result["summary_statistics"]
    sensitivity = result["sensitivity"]
    ci = result["bootstrap_95_ci"]
    size = result["size_normalization"]
    eligible = sorted(
        (item for item in observations if not item.excluded),
        key=lambda item: item.debt_density,
        reverse=True,
    )
    lines = [
        "# CodeSage health-score calibration",
        "",
        f"Generated: {result['calibration_timestamp']}",
        "",
        "## Dataset",
        "",
        f"- Input records: {dataset['input_records']}",
        f"- Eligible repositories: {dataset['eligible_repositories']}",
        f"- Excluded records: {dataset['excluded_records']}",
        f"- Manifest SHA-256: `{dataset['repository_manifest_sha256']}`",
        "",
        "## Selected calibration",
        "",
        f"- **k = {result['selected_k']:.6g}** ({result['method']['selected_rule']})",
        f"- Repository-level bootstrap 95% CI: [{ci['low']:.6g}, {ci['high']:.6g}]",
        f"- Percentile method: {result['method']['percentile_algorithm']}",
        "",
        "## Summary statistics",
        "",
        "| Statistic | D/KLOC |",
        "|---|---:|",
    ]
    order = ("min", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p97.5", "p99", "max", "iqr", "mad")
    lines.extend(f"| {name} | {stats[name]:.6g} |" for name in order)
    lines.extend([
        "",
        "## Sensitivity",
        "",
        "| Candidate | k |",
        "|---|---:|",
    ])
    lines.extend(f"| {name} | {value:.6g} |" for name, value in sensitivity.items())
    lines.extend([
        "",
        "## Largest debt-density repositories",
        "",
        "| Repository | Commit | KLOC | Debt | D/KLOC | Flags |",
        "|---|---|---:|---:|---:|---|",
    ])
    for item in eligible[:10]:
        lines.append(
            f"| {item.repository_id} | {item.commit_sha or 'n/a'} | {item.kloc:.6g} | "
            f"{item.total_weighted_debt:.6g} | {item.debt_density:.6g} | "
            f"{', '.join(item.flags) or 'none'} |"
        )
    lines.extend([
        "",
        "## Outliers and exclusions",
        "",
        f"- IQR upper fence: {result['outlier_diagnostics']['iqr_upper_fence']:.6g}",
        f"- Eligible repositories flagged by IQR: {result['outlier_diagnostics']['iqr_flag_count']}",
        f"- Exclusion reasons: `{json.dumps(dataset['exclusion_counts'], sort_keys=True)}`",
        "- Valid extreme repositories were retained; flags request review and are not exclusions.",
        "",
        "## Size-normalization check",
        "",
        f"- Spearman rho(D/KLOC, KLOC): {size['spearman_rho']}",
        f"- p-value: {size['p_value']} ({size['p_value_note'] or 'SciPy calculation'})",
        f"- Diagnostic convention: {size['review_threshold']}",
        "",
        "## Warnings",
        "",
    ])
    warnings = result["warnings"]
    lines.extend(f"- {warning}" for warning in warnings)
    if not warnings:
        lines.append("- None")
    lines.extend([
        "",
        "## Scoring configuration and provenance",
        "",
        "The calibrated k is valid only for this scoring configuration and compatible scan provenance.",
        "",
        "```json",
        json.dumps(_json_safe(result["configuration"]), indent=2, sort_keys=True),
        "```",
        "",
    ])
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSON file or directory")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--percentile", type=float, default=95.0)
    parser.add_argument("--bootstrap-samples", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=42)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    observations, manifest_hash = load_observations(args.input)
    result = calibrate(
        observations,
        manifest_hash,
        selected_percentile=args.percentile,
        bootstrap_samples=args.bootstrap_samples,
        seed=args.seed,
    )
    write_outputs(args.output_dir, result, observations)
    print(f"Selected k={result['selected_k']:.6g}; wrote results to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
