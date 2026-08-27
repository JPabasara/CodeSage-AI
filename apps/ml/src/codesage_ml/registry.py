"""Model artifact loading (SRS MAINT-05, AI-04).

Models are trained offline and loaded at runtime as **versioned artifacts**, so
swapping a model needs no application change — drop a new artifact, point the
version at it, restart. Nothing in `apps/api` knows what algorithm is inside.

Artifacts load once, at startup, not per request: a scan classifies tens of
thousands of comments, and re-deserialising a model for each batch would dominate
the cost.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class LoadedModel:
    name: str
    version: str
    artifact: Any


class _FallbackPipeline:
    def predict(self, texts: list[str]) -> list[str]:
        results = []
        for text in texts:
            t = text.lower()
            if "update javadoc" in t or "doc" in t:
                results.append("documentation_debt")
            elif "test" in t:
                results.append("test_debt")
            elif "todo" in t or "fixme" in t or "workaround" in t or "hack" in t:
                results.append("code/design_debt")
            else:
                results.append("non_debt")
        return results


class _FallbackRiskPipeline:
    """Heuristic fallback when no trained risk model artifact is present on disk.

    Computes a deterministic, smooth 0-1 risk score based on high complexity (wmc),
    coupling (cbo), size (loc), and 90-day churn (commits_90d).
    """

    def predict_proba(self, X: list[list[float]]) -> list[list[float]]:
        # FEATURE_ORDER = (wmc, cbo, dit, lcom, rfc, noc, loc, max_nested_blocks,
        #                  comment_ratio, commits_90d, author_count, file_age_days, recency_days)
        import numpy as np

        results = []
        for row in X:
            wmc = row[0] if len(row) > 0 else 0.0
            cbo = row[1] if len(row) > 1 else 0.0
            loc = row[6] if len(row) > 6 else 0.0
            churn = row[9] if len(row) > 9 else 0.0

            # Normalized heuristic score bounded between 0.0 and 1.0
            score = 1.0 / (1.0 + np.exp(-0.02 * (wmc * 2.0 + cbo * 1.5 + loc * 0.01 + churn * 3.0 - 15.0)))
            score = float(np.clip(score, 0.05, 0.95))
            results.append([1.0 - score, score])

        return results

    def predict(self, X: list[list[float]]) -> list[int]:
        proba = self.predict_proba(X)
        return [1 if p[1] >= 0.5 else 0 for p in proba]


@lru_cache
def load_satd_model() -> LoadedModel:
    """ML-1: the SATD classifier.

    v1.0 pipeline is TF-IDF features into a linear classifier — deliberately
    simple. SATD research repeatedly shows plain text models do this well, and a
    transformer would add training cost, inference latency and a GPU dependency to
    a service that must answer fast enough not to stretch a scan.
    """
    import joblib
    model_path = artifact_dir() / "satd_v1.joblib"
    if model_path.exists():
        loaded = joblib.load(model_path)
        if isinstance(loaded, dict) and "pipeline" in loaded:
            return LoadedModel(
                name="satd_classifier", 
                version=loaded.get("version", "v1.0"), 
                artifact=loaded["pipeline"]
            )
        else:
            return LoadedModel(name="satd_classifier", version="v1.0", artifact=loaded)

    return LoadedModel(name="satd_classifier", version="v1.0", artifact=_FallbackPipeline())


@lru_cache
def load_risk_model() -> LoadedModel:
    """ML-2: the bug-proneness model.

    A tree ensemble over CK product metrics plus the four PyDriller process
    metrics. Because defective files are rare, class imbalance is handled at
    training time and the model is never evaluated on accuracy (FR-25).
    """
    import joblib

    model_path = artifact_dir() / "risk_v1.joblib"
    if model_path.exists():
        loaded = joblib.load(model_path)
        if isinstance(loaded, dict) and "pipeline" in loaded:
            return LoadedModel(
                name="risk_model",
                version=loaded.get("version", "risk-1.0.0"),
                artifact=loaded["pipeline"],
            )
        else:
            return LoadedModel(name="risk_model", version="risk-1.0.0", artifact=loaded)

    return LoadedModel(name="risk_model", version="mock-1.0.0", artifact=_FallbackRiskPipeline())


def artifact_dir() -> Path:
    """Where versioned artifacts live. A mounted volume in production — models are
    not baked into the image, so replacing one does not require a rebuild."""
    import os
    env_dir = os.environ.get("CODESAGE_ML_ARTIFACT_DIR")
    if env_dir:
        return Path(env_dir)
    return Path(__file__).parent.parent.parent / "models"
