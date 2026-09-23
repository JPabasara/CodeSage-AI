from pathlib import Path

import joblib
import pytest

from codesage_ml import registry
from codesage_ml.risk.features import FEATURE_ORDER


@pytest.fixture(autouse=True)
def _clear_registry_cache() -> None:
    registry.load_risk_model.cache_clear()
    yield
    registry.load_risk_model.cache_clear()


class _ValidRiskPipeline:
    classes_ = [0, 1]

    def predict_proba(self, features):
        return features


class _NoProbabilityPipeline:
    classes_ = [0, 1]

    def predict(self, features):
        return features


class _WrongClassesPipeline:
    classes_ = [0, 2]

    def predict_proba(self, features):
        return features


def _configure_artifact(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    pipeline,
    feature_order: list[str] | None = None,
) -> None:
    model_path = tmp_path / "risk_v2.joblib"
    model_path.touch()

    monkeypatch.setattr(
        registry,
        "artifact_dir",
        lambda: tmp_path,
    )

    monkeypatch.setattr(
        joblib,
        "load",
        lambda _path: {
            "version": "risk-test",
            "feature_order": (
                list(FEATURE_ORDER)
                if feature_order is None
                else feature_order
            ),
            "pipeline": pipeline,
        },
    )


def test_risk_registry_accepts_current_artifact_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pipeline = _ValidRiskPipeline()

    _configure_artifact(
        monkeypatch,
        tmp_path,
        pipeline=pipeline,
    )

    loaded = registry.load_risk_model()

    assert loaded.version == "risk-test"
    assert loaded.artifact is pipeline


def test_risk_registry_rejects_stale_feature_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_artifact(
        monkeypatch,
        tmp_path,
        pipeline=_ValidRiskPipeline(),
        feature_order=["commits_90d"],
    )

    with pytest.raises(
        ValueError,
        match="feature order does not match",
    ):
        registry.load_risk_model()


def test_risk_registry_rejects_pipeline_without_predict_proba(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_artifact(
        monkeypatch,
        tmp_path,
        pipeline=_NoProbabilityPipeline(),
    )

    with pytest.raises(
        ValueError,
        match="must expose predict_proba",
    ):
        registry.load_risk_model()


def test_risk_registry_rejects_wrong_class_labels(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_artifact(
        monkeypatch,
        tmp_path,
        pipeline=_WrongClassesPipeline(),
    )

    with pytest.raises(
        ValueError,
        match=r"classes \{0, 1\}",
    ):
        registry.load_risk_model()