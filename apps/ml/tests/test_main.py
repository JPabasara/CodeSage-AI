from concurrent.futures import ThreadPoolExecutor

import pytest

from codesage_ml.main import classify, healthz, risk, version
from codesage_ml.registry import LoadedModel
from codesage_ml.risk.features import FEATURE_ORDER, build_vector
from codesage_ml.schemas import ClassifyRequest, RiskRequest


class _DeterministicRiskModel:
    classes_ = [0, 1]

    def predict_proba(self, vectors: list[list[float]]) -> list[list[float]]:
        probabilities = []
        for vector in vectors:
            if len(vector) != len(FEATURE_ORDER):
                raise ValueError("Expected the complete ML-2 feature vector")
            magnitude = sum(abs(value) for value in vector)
            risk_score = magnitude / (magnitude + 1_000.0)
            probabilities.append([1.0 - risk_score, risk_score])
        return probabilities


@pytest.fixture(autouse=True)
def _isolate_tests_from_risk_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    model = LoadedModel(
        name="risk_model",
        version="risk-test-21-features",
        artifact=_DeterministicRiskModel(),
    )
    monkeypatch.setattr("codesage_ml.main.load_risk_model", lambda: model)


def _complete_risk_metrics(**overrides: float) -> dict[str, float]:
    metrics = {name: 0.0 for name in FEATURE_ORDER}
    metrics.update(overrides)
    return metrics


def test_healthz() -> None:
    assert healthz() == {"status": "ok"}


def test_version_returns_model_versions() -> None:
    response = version()
    assert response.satd_model_version
    assert response.risk_model_version == "risk-test-21-features"


def test_classify_preserves_satd_behavior() -> None:
    response = classify(
        ClassifyRequest.model_validate({
            "comments": [
                {"id": "clean", "text": "Regular implementation note."},
                {"id": "debt", "text": "TODO: remove this workaround"},
            ]
        })
    )
    predictions = {item.id: item for item in response.predictions}
    assert predictions["clean"].is_debt is False
    assert predictions["clean"].category is None
    assert predictions["debt"].is_debt is True
    assert predictions["debt"].category != "security"


def test_classify_empty_list() -> None:
    response = classify(ClassifyRequest(comments=[]))
    assert response.predictions == []
    assert response.model_version


def test_concurrent_satd_requests_do_not_interfere() -> None:
    def predict(tag: str) -> list[dict[str, object]]:
        request = ClassifyRequest(
            comments=[
                {"id": f"{tag}-{index}", "text": "TODO: fix this"}
                for index in range(10)
            ]
        )
        return [prediction.model_dump() for prediction in classify(request).predictions]

    tags = ("A", "B", "C", "D")
    alone = [predict(tag) for tag in tags]
    with ThreadPoolExecutor(max_workers=len(tags)) as pool:
        together = list(pool.map(predict, tags))
    assert together == alone


def test_risk_returns_only_scores_and_version() -> None:
    response = risk(
        RiskRequest.model_validate({
            "classes": [
                {
                    "path": "src/Service.java",
                    "class_name": "Service",
                    "metrics": _complete_risk_metrics(wmc=10.0, cbo=5.0),
                }
            ]
        })
    )
    data = response.model_dump()
    assert set(data) == {"scores", "model_version"}
    assert data["model_version"] == "risk-test-21-features"
    assert data["scores"][0]["path"] == "src/Service.java"
    assert data["scores"][0]["class_name"] == "Service"
    assert 0.0 <= data["scores"][0]["risk_score"] <= 1.0


def test_risk_uses_positive_class_index_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ReversedClassRiskModel:
        classes_ = [1, 0]

        def predict_proba(self, vectors: list[list[float]]) -> list[list[float]]:
            assert len(vectors) == 1
            return [[0.73, 0.27]]

    monkeypatch.setattr(
        "codesage_ml.main.load_risk_model",
        lambda: LoadedModel(
            name="risk_model",
            version="risk-reversed-test",
            artifact=ReversedClassRiskModel(),
        ),
    )
    response = risk(
        RiskRequest.model_validate({
            "classes": [
                {
                    "path": "src/A.java",
                    "class_name": "A",
                    "metrics": _complete_risk_metrics(),
                }
            ]
        })
    )
    assert response.scores[0].risk_score == pytest.approx(0.73)


def test_risk_empty_list_returns_version() -> None:
    response = risk(RiskRequest(classes=[]))
    assert response.model_dump() == {
        "scores": [],
        "model_version": "risk-test-21-features",
    }


def test_feature_vector_builder_uses_canonical_order() -> None:
    raw_metrics = {
        name: float(index + 1)
        for index, name in enumerate(FEATURE_ORDER)
    }
    assert build_vector(raw_metrics) == [
        raw_metrics[name]
        for name in FEATURE_ORDER
    ]


def test_feature_vector_rejects_missing_features() -> None:
    metrics = _complete_risk_metrics()
    del metrics["numberOfVersionsUntil"]
    with pytest.raises(ValueError, match="Missing ML-2 features"):
        build_vector(metrics)


def test_feature_vector_rejects_unexpected_features() -> None:
    metrics = _complete_risk_metrics(commits_90d=10.0)
    with pytest.raises(ValueError, match="Unexpected ML-2 features"):
        build_vector(metrics)
