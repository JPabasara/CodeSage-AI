from pathlib import Path
from unittest.mock import Mock

import joblib
import pytest

from codesage_ml import registry
from codesage_ml.risk.features import FEATURE_ORDER


@pytest.fixture(autouse=True)
def _clear_registry_cache() -> None:
    registry.load_risk_model.cache_clear()
    yield
    registry.load_risk_model.cache_clear()


def _configure_artifact(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    feature_order: list[str],
) -> Mock:
    (tmp_path / "risk_v1.joblib").touch()
    pipeline = Mock()
    pipeline.predict_proba = Mock()
    monkeypatch.setattr(registry, "artifact_dir", lambda: tmp_path)
    monkeypatch.setattr(
        joblib,
        "load",
        lambda _path: {
            "version": "risk-test",
            "feature_order": feature_order,
            "pipeline": pipeline,
        },
    )
    return pipeline


def test_risk_registry_accepts_the_current_artifact_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pipeline = _configure_artifact(
        monkeypatch,
        tmp_path,
        feature_order=list(FEATURE_ORDER),
    )

    loaded = registry.load_risk_model()

    assert loaded.version == "risk-test"
    assert loaded.artifact is pipeline


def test_risk_registry_rejects_a_stale_artifact_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_artifact(
        monkeypatch,
        tmp_path,
        feature_order=["commits_90d"],
    )

    with pytest.raises(
        ValueError,
        match="feature order does not match",
    ):
        registry.load_risk_model()
