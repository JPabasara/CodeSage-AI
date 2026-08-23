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
    pipeline = joblib.load(model_path)
    return LoadedModel(name="satd_classifier", version="v1.0", artifact=pipeline)


@lru_cache
def load_risk_model() -> LoadedModel:
    """ML-2: the bug-proneness model.

    A tree ensemble over CK product metrics plus the four PyDriller process
    metrics. Because defective files are rare, class imbalance is handled at
    training time and the model is never evaluated on accuracy (FR-25).
    """
    raise NotImplementedError


def artifact_dir() -> Path:
    """Where versioned artifacts live. A mounted volume in production — models are
    not baked into the image, so replacing one does not require a rebuild."""
    return Path(__file__).parent.parent.parent / "models"
