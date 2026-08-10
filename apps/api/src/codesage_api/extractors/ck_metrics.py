"""Static Java metrics via CK (SRS FR-7).

CK is Mauricio Aniche's Java metrics tool. Two facts about it shape this module and
several decisions elsewhere:

**1. It is Java-only.** This is why SRS §2.4 limits v1.0 to analysing `.java`
files: the metric extractor cannot read anything else. A repository with no Java
sources produces an empty metric set and therefore no rule findings, which the
pipeline must handle as a valid (if empty) snapshot rather than an error.

**2. It is a JAR, not a Python package.** It runs as an external process, so the
worker image needs a JRE (see the Dockerfile) and this module is a subprocess
wrapper, not a library binding. That is also why it sits behind this single
boundary: replacing CK with another extractor later should be a one-file change
(MAINT-03, SUP-04).

CK writes CSV output — `class.csv` and `method.csv` — which this module parses into
the StaticMetric rows the rule engine and ML-2 consume. Metric names are kept as
CK emits them (WMC, CBO, DIT, LCOM, RFC, LOC, …) so that training and inference
read the same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class SymbolMetrics:
    """Metrics for one class or method, as CK reports them."""

    file_path: str  # relative to the clone root
    symbol_name: str
    symbol_type: str  # class | method
    start_line: int
    end_line: int
    metrics: dict[str, float]  # CK metric name → value


@dataclass(frozen=True, slots=True)
class FileMetrics:
    file_path: str
    loc: int
    metrics: dict[str, float]
    symbols: tuple[SymbolMetrics, ...]


def extract(clone_dir: Path) -> list[FileMetrics]:
    """Run CK over the checked-out tree and parse its CSV output.

    Only `.java` files are analysed. Returns one FileMetrics per source file, each
    carrying its symbols — which is the granularity the rule engine needs, since
    `complex-function`, `long-method` and `deep-nesting` all fire on a method while
    `large-file` fires on the file.

    TEAM TODO: pin the CK jar version and record it on AnalysisEngineVersion.
    ck_version, so REL-10's "same revision, consistent results" claim is checkable.
    """
    raise NotImplementedError


def compute_kloc(files: list[FileMetrics]) -> float:
    """Total thousands of lines of code — the denominator of repo_health (FR-11).

    A stored fact about the commit, written onto SNAPSHOT.kloc. Note that `k` is
    calibrated against whatever this function counts, so changing what it counts
    silently invalidates the calibration.
    """
    raise NotImplementedError
