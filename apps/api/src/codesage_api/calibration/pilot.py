"""Run a resumable calibration pilot through the production HTTP scan path.

The command deliberately orchestrates existing endpoints; cloning, extraction,
detection, persistence, and scoring remain owned by the normal CodeSage workers.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

CANONICAL_PROFILE = {
    "name": "Balanced",
    "weights": {
        "security": 1.0,
        "code_design": 1.0,
        "requirement": 1.0,
        "documentation": 1.0,
        "test": 1.0,
    },
    "trust_s": 0.5,
    "include_test_findings": False,
}
TERMINAL_PHASES = {"done", "error", "cancelled"}


def _progress(message: str) -> None:
    timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{timestamp}] {message}", flush=True)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _annotate_export(exported: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """Use the stable catalog slug while retaining CodeSage's internal UUID."""
    record = dict(exported)
    record["codesage_repository_id"] = record.get("repository_id")
    record["repository_id"] = str(entry["repo_id"])
    record["clone_url"] = str(entry["clone_url"])
    record["branch"] = str(entry["branch"])
    record["github_size_kb"] = entry.get("github_size_kb")
    record["repository_type"] = entry.get("type")
    return record


def _request(client: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
    for attempt in range(1, 4):
        response = client.request(method, path, **kwargs)
        if response.status_code not in {429, 502, 503, 504} or attempt == 3:
            break
        delay = float(response.headers.get("Retry-After", attempt * 5))
        _progress(f"{method} {path} returned {response.status_code}; retrying in {delay:g}s")
        time.sleep(delay)
    if response.is_error:
        detail = response.text.strip().replace("\n", " ")[:500]
        raise RuntimeError(f"{method} {path} returned HTTP {response.status_code}: {detail}")
    return response.json() if response.content else None


def _canonical_profile_id(client: httpx.Client) -> str:
    profiles = _request(client, "GET", "/api/profiles")
    matches = [
        item
        for item in profiles
        if item["name"] == CANONICAL_PROFILE["name"]
        and item["weights"] == CANONICAL_PROFILE["weights"]
        and float(item["trust_s"]) == CANONICAL_PROFILE["trust_s"]
        and bool(item["include_test_findings"])
        == CANONICAL_PROFILE["include_test_findings"]
    ]
    if len(matches) != 1:
        raise RuntimeError(
            "The workspace must contain exactly one unchanged canonical Balanced profile."
        )
    return str(matches[0]["id"])


def _connect(client: httpx.Client, entry: dict[str, Any]) -> dict[str, Any]:
    projects = _request(client, "GET", "/api/projects")
    existing = next(
        (item for item in projects if item["url"].rstrip("/") == entry["clone_url"].rstrip("/")),
        None,
    )
    if existing is not None:
        return existing
    return _request(client, "POST", "/api/projects", json={"url": entry["clone_url"]})


def _wait_for_scan(
    client: httpx.Client,
    repository_id: str,
    scan_id: str,
    label: str,
    *,
    poll_seconds: float,
    timeout_seconds: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    next_update = 0.0
    while time.monotonic() < deadline:
        status = _request(client, "GET", f"/api/repos/{repository_id}/scan/{scan_id}")
        if status["phase"] in TERMINAL_PHASES:
            return status
        now = time.monotonic()
        if now >= next_update:
            detail = status.get("stage") or status.get("message") or "worker active"
            _progress(f"{label}: scan phase={status['phase']} ({detail})")
            next_update = now + 30.0
        time.sleep(poll_seconds)
    raise TimeoutError(f"scan {scan_id} did not finish within {timeout_seconds:g} seconds")


def _wait_for_export(
    client: httpx.Client,
    repository_id: str,
    branch: str,
    *,
    poll_seconds: float,
    timeout_seconds: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    path = f"/api/repos/{repository_id}/health/calibration-export"
    while time.monotonic() < deadline:
        response = client.get(path, params={"branch": branch})
        if response.status_code == 200:
            return response.json()
        if response.status_code != 503:
            response.raise_for_status()
        time.sleep(poll_seconds)
    raise TimeoutError("score export did not become ready before the timeout")


def run_pilot(
    manifest_path: Path,
    output_dir: Path,
    *,
    api_base: str,
    session_cookie: str,
    poll_seconds: float,
    scan_timeout_seconds: float,
    limit: int | None,
    delay_seconds: float,
) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    records_dir = output_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=True)
    failures: list[dict[str, object]] = []
    completed = 0
    headers = {"Cookie": f"codesage_session={session_cookie}"}

    with httpx.Client(base_url=api_base.rstrip("/"), headers=headers, timeout=60.0) as client:
        profile_id = _canonical_profile_id(client)
        candidates = [entry for entry in manifest["repositories"] if entry.get("enabled", True)]
        if limit is not None:
            candidates = candidates[:limit]
        total = len(candidates)
        _progress(f"canonical profile verified; processing {total} enabled repositories")
        for index, entry in enumerate(candidates, start=1):
            slug = str(entry["repo_id"])
            record_path = records_dir / f"{slug.replace('/', '__')}.json"
            if record_path.exists():
                existing = json.loads(record_path.read_text(encoding="utf-8"))
                _write_json(record_path, _annotate_export(existing, entry))
                completed += 1
                entry["pilot_status"] = "already_exported"
                _progress(f"[{index}/{total}] {slug}: already exported")
                continue
            _progress(f"[{index}/{total}] {slug}: connecting")
            try:
                project = _connect(client, entry)
                repository_id = str(project["id"])
                branch = str(entry.get("branch") or project["default_branch"])
                branches = _request(client, "GET", f"/api/repos/{repository_id}/branches")
                selected = next(item for item in branches if item["name"] == branch)
                entry["resolved_commit_sha"] = selected["head_commit_sha"]
                entry["codesage_repository_id"] = repository_id
                _request(
                    client,
                    "PUT",
                    f"/api/projects/{repository_id}/profile",
                    json={"profile_id": profile_id},
                )
                _progress(
                    f"[{index}/{total}] {slug}: scanning {branch}@"
                    f"{str(entry['resolved_commit_sha'])[:12]}"
                )
                started = _request(
                    client,
                    "POST",
                    f"/api/repos/{repository_id}/scan",
                    json={"branch": branch},
                )
                final = _wait_for_scan(
                    client,
                    repository_id,
                    str(started["scan_id"]),
                    slug,
                    poll_seconds=poll_seconds,
                    timeout_seconds=scan_timeout_seconds,
                )
                if final["phase"] != "done":
                    raise RuntimeError(
                        f"scan ended as {final['phase']}: {final.get('error') or 'no detail'}"
                    )
                exported = _wait_for_export(
                    client,
                    repository_id,
                    branch,
                    poll_seconds=poll_seconds,
                    timeout_seconds=300,
                )
                _write_json(record_path, _annotate_export(exported, entry))
                entry["pilot_status"] = "exported"
                completed += 1
                _progress(f"[{index}/{total}] {slug}: exported ({completed} successful)")
            except (
                httpx.HTTPError,
                KeyError,
                RuntimeError,
                StopIteration,
                TimeoutError,
                TypeError,
                ValueError,
            ) as exc:
                entry["pilot_status"] = "failed"
                error = str(exc) or type(exc).__name__
                entry["failure"] = error
                failures.append({"repo_id": slug, "error": error})
                _progress(f"[{index}/{total}] {slug}: FAILED: {error}")
            finally:
                _write_json(output_dir / "resolved-manifest.json", manifest)
                _write_json(output_dir / "failures.json", failures)
                if delay_seconds > 0 and index < total:
                    time.sleep(delay_seconds)

    summary = {
        "successful_repositories": completed,
        "failed_repositories": len(failures),
        "attempted_repositories": total,
        "canonical_profile": CANONICAL_PROFILE,
    }
    _write_json(output_dir / "run-summary.json", summary)
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument(
        "--session-cookie",
        default=os.environ.get("CODESAGE_SESSION"),
        help="Authenticated codesage_session value; defaults to CODESAGE_SESSION",
    )
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--scan-timeout-seconds", type=float, default=1_200.0)
    parser.add_argument(
        "--limit",
        type=int,
        help="Process only the first N enabled candidates; omit to process all",
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=5.0,
        help="Pause between repositories to avoid overwhelming the API",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.session_cookie:
        raise SystemExit("Set CODESAGE_SESSION or pass --session-cookie.")
    summary = run_pilot(
        args.manifest,
        args.output_dir,
        api_base=args.api_base,
        session_cookie=args.session_cookie,
        poll_seconds=args.poll_seconds,
        scan_timeout_seconds=args.scan_timeout_seconds,
        limit=args.limit,
        delay_seconds=args.delay_seconds,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["successful_repositories"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
