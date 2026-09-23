"""Model artifact loading (SRS MAINT-05, AI-04).

Models are trained offline and loaded at runtime as versioned artifacts.

The ML-2 artifact must explicitly declare the feature contract it was trained
with. An artifact whose feature order differs from the current inference
contract is rejected rather than being used with semantically incompatible
inputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from codesage_ml.risk.features import (
    FEATURE_ORDER,
    NEGATIVE_CLASS,
    POSITIVE_CLASS,
)


@dataclass(frozen=True, slots=True)
class LoadedModel:
    name: str
    version: str
    artifact: Any



class _FallbackPipeline:
    """Simple fallback for ML-1 SATD classification."""

    def predict(self, texts: list[str]) -> list[str]:
        results = []

        for text in texts:
            t = text.lower()

            if "update javadoc" in t or "doc" in t:
                results.append("documentation_debt")
            elif "test" in t:
                results.append("test_debt")
            elif (
                "todo" in t
                or "fixme" in t
                or "workaround" in t
                or "hack" in t
            ):
                results.append("code/design_debt")
            else:
                results.append("non_debt")

        return results


@lru_cache
def load_satd_model() -> LoadedModel:
    """Load ML-1, the SATD classifier."""
    import joblib

    model_path = artifact_dir() / "satd_v1.joblib"

    if model_path.exists():
        loaded = joblib.load(model_path)

        if isinstance(loaded, dict) and "pipeline" in loaded:
            return LoadedModel(
                name="satd_classifier",
                version=loaded.get("version", "v1.0"),
                artifact=loaded["pipeline"],
            )

        return LoadedModel(
            name="satd_classifier",
            version="v1.0",
            artifact=loaded,
        )

    return LoadedModel(
        name="satd_classifier",
        version="v1.0",
        artifact=_FallbackPipeline(),
    )


@lru_cache
def load_risk_model() -> LoadedModel:
    """Load ML-2, the class-level bug-proneness model.

    The artifact is accepted only when it declares the exact feature order
    expected by the current inference service.

    This prevents an older model from silently receiving a newer or reordered
    feature vector.
    """
    import joblib

    model_path = artifact_dir() / "risk_v2.joblib"

    if not model_path.exists():
        raise FileNotFoundError(
            f"ML-2 model artifact was not found at {model_path}"
        )

    loaded = joblib.load(model_path)

    if not isinstance(loaded, dict):
        raise ValueError(
            "ML-2 artifact must be a versioned artifact dictionary"
        )

    if "pipeline" not in loaded:
        raise ValueError(
            "ML-2 artifact is missing the trained pipeline"
        )

    version = loaded.get("version")

    if not isinstance(version, str) or not version.strip():
        raise ValueError(
            "ML-2 artifact is missing a valid version"
        )

    artifact_features = loaded.get("feature_order")

    if artifact_features != list(FEATURE_ORDER):
        raise ValueError(
            "ML-2 model feature order does not match "
            "the inference contract"
        )

    pipeline = loaded["pipeline"]

    if not hasattr(pipeline, "predict_proba"):
        raise ValueError(
            "ML-2 artifact must expose predict_proba"
        )

    classes = getattr(pipeline, "classes_", None)

    if classes is None:
        raise ValueError(
            "ML-2 artifact does not expose fitted class labels"
        )

    class_labels = list(classes)

    if (
        len(class_labels) != 2
        or set(class_labels) != {NEGATIVE_CLASS, POSITIVE_CLASS}
    ):
        raise ValueError(
            "ML-2 artifact must be a binary classifier "
            f"with classes {{{NEGATIVE_CLASS}, {POSITIVE_CLASS}}}"
        )

    return LoadedModel(
        name="risk_model",
        version=version.strip(),
        artifact=pipeline,
    )


def artifact_dir() -> Path:
    """Return the directory containing versioned ML artifacts."""
    import os

    env_dir = os.environ.get(
        "CODESAGE_ML_ARTIFACT_DIR"
    )

    if env_dir:
        return Path(env_dir)

    return (
        Path(__file__).parent.parent.parent
        / "models"
    )