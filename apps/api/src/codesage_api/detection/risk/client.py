"""ML-2 client: feature vectors in, per-file risk scores out (SRS FR-10).

**This model produces no findings.** It has exactly two effects:

  1. it boosts the priority of findings *already in that file*, through the bounded
     `risk_factor` multiplier;
  2. it appears as a per-file risk badge.

A risky file with no findings contributes no debt and renders green. That is the
point: every point of debt must trace to a finding the user can open. A file
tinted red purely by model unease, opening to an empty detail panel, is exactly
the un-actionable noise this product exists to avoid.

It assigns neither category nor severity, because it is not a list row at all.
"""

from __future__ import annotations

from codesage_api.extractors.ck_metrics import FileMetrics
from codesage_api.extractors.process_metrics import FileProcessMetrics


def predict(
    files: list[FileMetrics], process: dict[str, FileProcessMetrics]
) -> dict[str, float]:
    """Score every file 0.0–1.0. Returns {file_path: risk_score}.

    Features are CK product metrics plus the four PyDriller process metrics — the
    same feature set used in training, in the same order. A mismatch here is
    silent: the model returns plausible numbers computed from the wrong columns,
    so the feature order is owned by `apps/ml` and imported, never re-listed.

    Presented as a risk indicator, never as a bug oracle. Because defective files
    are rare, the model is evaluated on precision/recall/F1/AUC and never on
    accuracy (FR-25).

    Raises MLServiceUnavailable on timeout. The caller then stores 0.0 for every
    file, which makes risk_factor 1.0 and boosts nothing — degraded, but a valid
    snapshot.
    """
    raise NotImplementedError
