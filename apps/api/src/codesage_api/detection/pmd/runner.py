from __future__ import annotations

import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from xml.etree import ElementTree

from codesage_api.detection.pmd.config import PMDConfig
from codesage_api.detection.pmd.scope import iter_java_files
from codesage_api.logging import get_logger

PMD_VERSION = "7.27.0"
logger = get_logger(__name__)


class PMDRunError(RuntimeError):
    """PMD could not complete a usable analysis."""


class PMDExecutableMissing(PMDRunError):
    pass


class PMDTimeout(PMDRunError):
    pass


@dataclass(frozen=True, slots=True)
class PMDRunOutput:
    report: str
    stderr: str
    return_code: int = 0


def run(repository_path: Path, config: PMDConfig) -> PMDRunOutput:
    """Execute PMD safely against the centralized repository scope."""
    if not config.executable.is_file():
        raise PMDExecutableMissing(f"PMD executable was not found at {config.executable}.")
    if not config.ruleset.is_file():
        raise FileNotFoundError(f"Bundled PMD ruleset was not found at {config.ruleset}.")

    with tempfile.TemporaryDirectory(prefix="codesage-pmd-") as directory:
        output = Path(directory)
        report_path = output / "report.xml"
        file_list_path = output / "java-files.txt"
        file_list_path.write_text(
            "".join(f"{path}\n" for path in iter_java_files(repository_path)),
            encoding="utf-8",
        )
        command = [
            str(config.executable),
            "check",
            "--file-list",
            str(file_list_path),
            "--rulesets",
            str(config.ruleset),
            "--format",
            "xml",
            "--report-file",
            str(report_path),
            "--relativize-paths-with",
            str(repository_path),
            "--no-cache",
            "--no-progress",
            "--no-fail-on-violation",
        ]
        if config.java_version:
            command.extend(["--use-version", f"java-{config.java_version}"])
        if config.aux_classpath:
            command.extend(
                ["--aux-classpath", ":".join(str(path) for path in config.aux_classpath)]
            )
        started = perf_counter()
        logger.info(
            "PMD process started",
            extra={
                "event": "detector_process_started",
                "stage": "detect",
                "detector": "pmd",
                "pmd_version": PMD_VERSION,
                "timeout_seconds": config.timeout_seconds,
                "java_version": config.java_version or "unresolved",
                "aux_classpath_entries": len(config.aux_classpath),
            },
        )
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=config.timeout_seconds,
            )
        except FileNotFoundError as exc:
            raise PMDExecutableMissing(
                f"PMD executable could not be started: {config.executable}."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise PMDTimeout(
                f"PMD exceeded its {config.timeout_seconds:g}-second timeout."
            ) from exc
        except OSError as exc:
            raise PMDRunError("PMD could not be started.") from exc

        logger.log(
            logging.INFO if completed.returncode == 0 else logging.WARNING,
            "PMD process completed",
            extra={
                "event": "detector_process_completed",
                "stage": "detect",
                "detector": "pmd",
                "pmd_version": PMD_VERSION,
                "duration_ms": round((perf_counter() - started) * 1000),
                "return_code": completed.returncode,
                "report_created": report_path.is_file(),
                "stderr": completed.stderr.strip()[-4000:],
            },
        )
        if not report_path.is_file():
            detail = completed.stderr.strip()[-4000:] or "no diagnostic output"
            if completed.returncode != 0:
                raise PMDRunError(
                    f"PMD exited with status {completed.returncode}: {detail}"
                )
            raise PMDRunError("PMD completed without producing its XML report.")
        try:
            report = report_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise PMDRunError("PMD produced an unreadable XML report.") from exc
        try:
            root = ElementTree.fromstring(report)
        except ElementTree.ParseError as exc:
            raise PMDRunError("PMD produced an invalid XML report.") from exc
        if root.get("version") != PMD_VERSION:
            raise PMDRunError(
                f"Expected PMD {PMD_VERSION}, got {root.get('version', 'unknown')}."
            )
        return PMDRunOutput(
            report=report,
            stderr=completed.stderr,
            return_code=completed.returncode,
        )
