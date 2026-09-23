from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from codesage_ml.main import app, classify
from codesage_ml.registry import LoadedModel
from codesage_ml.risk.features import FEATURE_ORDER, build_vector
from codesage_ml.schemas import ClassifyRequest

client = TestClient(app)


class _DeterministicRiskModel:
    """Test double for the current 21-feature class-level ML-2 contract."""

    def predict_proba(self, vectors: list[list[float]]) -> list[list[float]]:
        probabilities: list[list[float]] = []
        for vector in vectors:
            if len(vector) != len(FEATURE_ORDER):
                raise ValueError("Expected the complete ML-2 feature vector")
            magnitude = sum(abs(value) for value in vector)
            risk_score = magnitude / (magnitude + 1_000.0)
            probabilities.append([1.0 - risk_score, risk_score])
        return probabilities


@pytest.fixture(autouse=True)
def _isolate_api_tests_from_risk_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    model = LoadedModel(
        name="risk_model",
        version="risk-test-21-features",
        artifact=_DeterministicRiskModel(),
        kind="trained",
    )
    monkeypatch.setattr("codesage_ml.main.load_risk_model", lambda: model)


# ---------------------------------------------------------------------------
# SATD test fixtures
# ---------------------------------------------------------------------------

NON_DEBT_ID = "c1"
NON_DEBT_TEXT = "This is a regular comment explaining functionality."

DEBT_ID = "c2"
DEBT_TEXT = "TODO: fix this workaround to avoid memory leak"


# ---------------------------------------------------------------------------
# Service health / metadata
# ---------------------------------------------------------------------------


def test_healthz():
    """Verify healthcheck endpoint returns status ok."""
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version():
    """Verify version endpoint returns deployed model versions."""
    response = client.get("/version")

    assert response.status_code == 200

    data = response.json()

    assert data["satd_model_version"] in (
        "v1.0",
        "satd-1.0.0",
    )

    # ML-2 now requires a real versioned artifact using the current
    # 21-feature contract. Once the production artifact version is frozen,
    # this assertion can be made exact.
    assert isinstance(data["risk_model_version"], str)
    assert data["risk_model_version"]


# ---------------------------------------------------------------------------
# ML-1: SATD
# ---------------------------------------------------------------------------


def test_classify():
    """Verify classification output structure and validity."""
    payload = {
        "comments": [
            {
                "id": NON_DEBT_ID,
                "text": NON_DEBT_TEXT,
            },
            {
                "id": DEBT_ID,
                "text": DEBT_TEXT,
            },
        ]
    }

    response = client.post(
        "/classify",
        json=payload,
    )

    assert response.status_code == 200

    data = response.json()

    assert "model_version" in data
    assert data["model_version"] in (
        "v1.0",
        "satd-1.0.0",
    )

    predictions = data["predictions"]

    assert len(predictions) == 2

    for i, pred in enumerate(predictions):
        assert pred["id"] == payload["comments"][i]["id"]

        if not pred["is_debt"]:
            assert pred["category"] is None
        else:
            assert pred["category"] is not None

        assert pred["category"] != "security"


def test_classify_covers_both_branches():
    """Guards that both debt and non-debt outcomes are exercised."""
    payload = {
        "comments": [
            {
                "id": NON_DEBT_ID,
                "text": NON_DEBT_TEXT,
            },
            {
                "id": DEBT_ID,
                "text": DEBT_TEXT,
            },
        ]
    }

    predictions = client.post(
        "/classify",
        json=payload,
    ).json()["predictions"]

    outcomes = {
        prediction["id"]: prediction["is_debt"]
        for prediction in predictions
    }

    assert outcomes[NON_DEBT_ID] is False
    assert outcomes[DEBT_ID] is True


def test_same_id_gives_the_same_answer():
    """Model predictions are deterministic across identical requests."""
    payload = {
        "comments": [
            {
                "id": f"c{i}",
                "text": "TODO: fix this",
            }
            for i in range(20)
        ]
    }

    first = client.post(
        "/classify",
        json=payload,
    ).json()["predictions"]

    second = client.post(
        "/classify",
        json=payload,
    ).json()["predictions"]

    assert first == second


def test_concurrent_requests_do_not_interfere():
    """Verify thread-safety under concurrent inference requests."""

    def predict(
        tag: str,
    ) -> dict[str, tuple[bool, str | None, float]]:
        request = ClassifyRequest(
            comments=[
                {
                    "id": f"{tag}-{i}",
                    "text": (
                        "TODO: fix this"
                        if i % 2 == 0
                        else "clean code"
                    ),
                }
                for i in range(40)
            ]
        )

        return {
            prediction.id: (
                prediction.is_debt,
                prediction.category,
                prediction.confidence,
            )
            for prediction in classify(request).predictions
        }

    tags = (
        "A",
        "B",
        "C",
        "D",
    )

    alone: dict[
        str,
        tuple[bool, str | None, float],
    ] = {}

    for tag in tags:
        alone.update(predict(tag))

    for _ in range(5):
        with ThreadPoolExecutor(
            max_workers=len(tags)
        ) as pool:
            together: dict[
                str,
                tuple[bool, str | None, float],
            ] = {}

            for result in pool.map(
                predict,
                tags,
            ):
                together.update(result)

        assert together == alone


def test_debt_rate_resembles_the_training_corpus():
    """About 15% of comments are debt, as in SATDAUG."""
    comments = []

    for i in range(2000):
        text = (
            "TODO: fix workaround"
            if i < 300
            else "normal function description"
        )

        comments.append(
            {
                "id": f"id-{i}",
                "text": text,
            }
        )

    payload = {
        "comments": comments,
    }

    predictions = client.post(
        "/classify",
        json=payload,
    ).json()["predictions"]

    debt_rate = (
        sum(
            prediction["is_debt"]
            for prediction in predictions
        )
        / len(predictions)
    )

    assert 0.10 <= debt_rate <= 0.22


def test_classify_empty_list():
    """Classifying an empty list returns an empty result."""
    response = client.post(
        "/classify",
        json={"comments": []},
    )

    assert response.status_code == 200
    assert response.json()["predictions"] == []

    assert response.json()["model_version"] in (
        "v1.0",
        "satd-1.0.0",
    )


def test_all_satd_categories():
    """Verify representative SATD categories."""
    payload = {
        "comments": [
            {
                "id": "cat_doc",
                "text": (
                    "TODO: update javadoc documentation "
                    "for this parameter"
                ),
            },
            {
                "id": "cat_test",
                "text": (
                    "TODO: write test cases for this class"
                ),
            },
        ]
    }

    response = client.post(
        "/classify",
        json=payload,
    )

    assert response.status_code == 200

    predictions = {
        prediction["id"]: prediction
        for prediction
        in response.json()["predictions"]
    }

    assert predictions["cat_doc"]["is_debt"] is True
    assert predictions["cat_doc"]["category"] in [
        "documentation",
        "code-design",
    ]

    assert predictions["cat_test"]["is_debt"] is True
    assert predictions["cat_test"]["category"] in [
        "test",
        "code-design",
    ]


def test_security_category_never_predicted():
    """Security must never be emitted by the SATD classifier."""
    payload = {
        "comments": [
            {
                "id": "sec_1",
                "text": (
                    "TODO: security vulnerability "
                    "in password hashing"
                ),
            },
            {
                "id": "sec_2",
                "text": (
                    "FIXME: SQL injection risk "
                    "in query builder"
                ),
            },
        ]
    }

    response = client.post(
        "/classify",
        json=payload,
    )

    assert response.status_code == 200

    for prediction in response.json()["predictions"]:
        assert prediction["category"] != "security"


# ---------------------------------------------------------------------------
# ML-2: Bug-proneness
# ---------------------------------------------------------------------------


def _complete_risk_metrics(
    **overrides: float,
) -> dict[str, float]:
    """Build a complete valid ML-2 feature payload."""
    metrics = {
        name: 0.0
        for name in FEATURE_ORDER
    }

    metrics.update(overrides)

    return metrics


def test_risk():
    """Verify ML-2 returns one probability for each input class."""
    payload = {
        "classes": [
            {
                "path": "src/Service.java",
                "class_name": "Service",
                "metrics": _complete_risk_metrics(
                    wmc=10.0,
                    cbo=5.0,
                    dit=2.0,
                    lcom=3.0,
                    rfc=20.0,
                    noc=1.0,
                    numberOfLinesOfCode=250.0,
                    numberOfMethods=12.0,
                    numberOfVersionsUntil=15.0,
                    numberOfAuthorsUntil=3.0,
                    linesAddedUntil=500.0,
                    maxLinesAddedUntil=100.0,
                    avgLinesAddedUntil=33.3,
                    linesRemovedUntil=200.0,
                    maxLinesRemovedUntil=50.0,
                    avgLinesRemovedUntil=13.3,
                    codeChurnUntil=300.0,
                    maxCodeChurnUntil=80.0,
                    avgCodeChurnUntil=20.0,
                    ageWithRespectTo=52.0,
                    weightedAgeWithRespectTo=30.0,
                ),
            }
        ]
    }

    response = client.post(
        "/risk",
        json=payload,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["model_version"]
    assert data["model_kind"] == "trained"

    scores = data["scores"]

    assert len(scores) == 1

    score = scores[0]

    assert score["path"] == "src/Service.java"
    assert score["class_name"] == "Service"
    assert 0.0 <= score["risk_score"] <= 1.0


def test_risk_preserves_class_identity():
    """Classes sharing a file remain separate ML observations."""
    payload = {
        "classes": [
            {
                "path": "src/Example.java",
                "class_name": "Example",
                "metrics": _complete_risk_metrics(
                    wmc=20.0,
                    cbo=8.0,
                    numberOfLinesOfCode=400.0,
                    numberOfMethods=20.0,
                    numberOfVersionsUntil=30.0,
                ),
            },
            {
                "path": "src/Example.java",
                "class_name": "Helper",
                "metrics": _complete_risk_metrics(
                    wmc=5.0,
                    cbo=2.0,
                    numberOfLinesOfCode=80.0,
                    numberOfMethods=4.0,
                    numberOfVersionsUntil=30.0,
                ),
            },
        ]
    }

    response = client.post(
        "/risk",
        json=payload,
    )

    assert response.status_code == 200

    scores = response.json()["scores"]

    assert len(scores) == 2

    assert scores[0]["path"] == "src/Example.java"
    assert scores[0]["class_name"] == "Example"

    assert scores[1]["path"] == "src/Example.java"
    assert scores[1]["class_name"] == "Helper"


def test_risk_batch_preserves_order_and_is_deterministic():
    """Batch inference preserves order and is deterministic."""
    classes = [
        {
            "path": f"src/module{i}/Service.java",
            "class_name": "Service",
            "metrics": _complete_risk_metrics(
                wmc=float(i * 5),
                cbo=float(i),
                numberOfLinesOfCode=float(i * 100),
                numberOfMethods=float(i * 3),
                numberOfVersionsUntil=float(i + 1),
            ),
        }
        for i in range(10)
    ]

    payload = {
        "classes": classes,
    }

    first_response = client.post(
        "/risk",
        json=payload,
    )

    second_response = client.post(
        "/risk",
        json=payload,
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200

    first = first_response.json()
    second = second_response.json()

    assert (
        first["model_version"]
        == second["model_version"]
    )

    scores_1 = first["scores"]
    scores_2 = second["scores"]

    assert len(scores_1) == 10
    assert len(scores_2) == 10

    for i in range(10):
        assert (
            scores_1[i]["path"]
            == classes[i]["path"]
        )

        assert (
            scores_1[i]["class_name"]
            == classes[i]["class_name"]
        )

        assert (
            scores_2[i]["path"]
            == classes[i]["path"]
        )

        assert (
            scores_2[i]["class_name"]
            == classes[i]["class_name"]
        )

        assert scores_1[i][
            "risk_score"
        ] == pytest.approx(
            scores_2[i]["risk_score"],
            abs=1e-5,
        )

        assert (
            0.0
            <= scores_1[i]["risk_score"]
            <= 1.0
        )


def test_risk_empty_list():
    """An empty class batch returns no predictions."""
    response = client.post(
        "/risk",
        json={"classes": []},
    )

    assert response.status_code == 200
    assert response.json()["scores"] == []


# ---------------------------------------------------------------------------
# ML-2 feature contract
# ---------------------------------------------------------------------------


def test_feature_vector_builder_canonical_order():
    """build_vector follows the exact 21-feature contract."""
    raw_metrics = {
        name: float(i + 1)
        for i, name in enumerate(FEATURE_ORDER)
    }

    vector = build_vector(raw_metrics)

    assert len(FEATURE_ORDER) == 21
    assert len(vector) == 21

    for i, name in enumerate(FEATURE_ORDER):
        assert vector[i] == raw_metrics[name]


def test_feature_vector_rejects_missing_features():
    """Missing ML-2 features must fail loudly."""
    raw_metrics = {
        name: 0.0
        for name in FEATURE_ORDER
    }

    del raw_metrics["numberOfVersionsUntil"]

    with pytest.raises(
        ValueError,
        match="Missing ML-2 features",
    ):
        build_vector(raw_metrics)


def test_feature_vector_rejects_unexpected_features():
    """Unknown ML-2 features must fail loudly."""
    raw_metrics = {
        name: 0.0
        for name in FEATURE_ORDER
    }

    raw_metrics["commits_90d"] = 10.0

    with pytest.raises(
        ValueError,
        match="Unexpected ML-2 features",
    ):
        build_vector(raw_metrics)
