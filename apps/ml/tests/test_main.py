from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from codesage_ml.main import app, classify
from codesage_ml.registry import _FallbackRiskPipeline
from codesage_ml.risk.features import FEATURE_ORDER, build_vector
from codesage_ml.schemas import ClassifyRequest

client = TestClient(app)

# Test IDs with representative debt / non-debt texts
NON_DEBT_ID = "c1"
NON_DEBT_TEXT = "This is a regular comment explaining functionality."
DEBT_ID = "c2"
DEBT_TEXT = "TODO: fix this workaround to avoid memory leak"


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
    assert data["satd_model_version"] in ("v1.0", "satd-1.0.0")
    assert data["risk_model_version"] in (
        "risk-fallback-heuristic-1.0",
        "risk-1.0.0",
    )


def test_classify():
    """Verify classification output structure and validity."""
    payload = {
        "comments": [
            {"id": NON_DEBT_ID, "text": NON_DEBT_TEXT},
            {"id": DEBT_ID, "text": DEBT_TEXT},
        ]
    }
    response = client.post("/classify", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "model_version" in data
    assert data["model_version"] in ("v1.0", "satd-1.0.0")

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
            {"id": NON_DEBT_ID, "text": NON_DEBT_TEXT},
            {"id": DEBT_ID, "text": DEBT_TEXT},
        ]
    }
    predictions = client.post("/classify", json=payload).json()["predictions"]

    outcomes = {p["id"]: p["is_debt"] for p in predictions}
    assert outcomes[NON_DEBT_ID] is False, f"{NON_DEBT_ID} should be non-debt"
    assert outcomes[DEBT_ID] is True, f"{DEBT_ID} should be debt"


def test_same_id_gives_the_same_answer():
    """Model predictions are deterministic across identical requests."""
    payload = {"comments": [{"id": f"c{i}", "text": "TODO: fix this"} for i in range(20)]}

    first = client.post("/classify", json=payload).json()["predictions"]
    second = client.post("/classify", json=payload).json()["predictions"]

    assert first == second


def test_concurrent_requests_do_not_interfere():
    """Verify thread-safety under concurrent inference requests."""

    def predict(tag: str) -> dict[str, tuple[bool, str | None, float]]:
        request = ClassifyRequest(
            comments=[
                {"id": f"{tag}-{i}", "text": "TODO: fix this" if i % 2 == 0 else "clean code"}
                for i in range(40)
            ]
        )
        return {p.id: (p.is_debt, p.category, p.confidence) for p in classify(request).predictions}

    tags = ("A", "B", "C", "D")
    alone: dict[str, tuple[bool, str | None, float]] = {}
    for tag in tags:
        alone.update(predict(tag))

    for _ in range(5):
        with ThreadPoolExecutor(max_workers=len(tags)) as pool:
            together: dict[str, tuple[bool, str | None, float]] = {}
            for result in pool.map(predict, tags):
                together.update(result)
        assert together == alone


def test_debt_rate_resembles_the_training_corpus():
    """About 15% of comments are debt, as in SATDAUG (see satd/labels.py)."""
    # 300 debt comments out of 2000 = 15.0%
    comments = []
    for i in range(2000):
        text = "TODO: fix workaround" if i < 300 else "normal function description"
        comments.append({"id": f"id-{i}", "text": text})

    payload = {"comments": comments}
    predictions = client.post("/classify", json=payload).json()["predictions"]

    debt_rate = sum(p["is_debt"] for p in predictions) / len(predictions)
    assert 0.10 <= debt_rate <= 0.22, f"debt rate {debt_rate:.1%} — expected about 15%"


def test_classify_empty_list():
    """Verify classifying empty list of comments returns empty list."""
    response = client.post("/classify", json={"comments": []})
    assert response.status_code == 200
    assert response.json()["predictions"] == []
    assert response.json()["model_version"] in ("v1.0", "satd-1.0.0")


def test_all_satd_categories():
    """Verify classifier detects various debt types (documentation, test, requirement)."""
    payload = {
        "comments": [
            {"id": "cat_doc", "text": "TODO: update javadoc documentation for this parameter"},
            {"id": "cat_test", "text": "TODO: write test cases for this class"},
        ]
    }
    response = client.post("/classify", json=payload)
    assert response.status_code == 200
    data = response.json()
    predictions = {p["id"]: p for p in data["predictions"]}

    assert predictions["cat_doc"]["is_debt"] is True
    assert predictions["cat_doc"]["category"] in ["documentation", "code-design"]

    assert predictions["cat_test"]["is_debt"] is True
    assert predictions["cat_test"]["category"] in ["test", "code-design"]


def test_security_category_never_predicted():
    """Verify that 'security' category is NEVER emitted by the ML classifier (SRS FR-9.3)."""
    payload = {
        "comments": [
            {"id": "sec_1", "text": "TODO: security vulnerability in password hashing"},
            {"id": "sec_2", "text": "FIXME: SQL injection risk in query builder"},
        ]
    }
    response = client.post("/classify", json=payload)
    assert response.status_code == 200
    data = response.json()
    for pred in data["predictions"]:
        assert pred["category"] != "security"


def test_risk():
    """Verify bug-risk endpoint returns score per file."""
    payload = {
        "files": [
            {
                "path": "src/main.py",
                "metrics": {
                    "wmc": 10.0,
                    "commits_90d": 5.0,
                    "file_age_days": 15.0,
                    "author_count": 2.0,
                    "cbo": 5.0,
                },
            }
        ]
    }
    response = client.post("/risk", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "model_version" in data
    assert data["model_version"] in (
        "risk-fallback-heuristic-1.0",
        "risk-1.0.0",
    )
    assert data["model_kind"] in ("trained", "heuristic")

    scores = data["scores"]
    assert len(scores) == 1
    score = scores[0]
    assert score["path"] == "src/main.py"
    assert 0.0 <= score["risk_score"] <= 1.0


def test_risk_accepts_supported_history_metrics():
    """The endpoint accepts the two AEEEM-compatible history fields."""
    payload = {
        "files": [
            {
                "path": "src/HigherHistoryRisk.java",
                "metrics": {
                    "author_count": 20.0,
                    "file_age_days": 500.0,
                },
            },
            {
                "path": "src/LowerHistoryRisk.java",
                "metrics": {
                    "author_count": 2.0,
                    "file_age_days": 500.0,
                },
            },
        ]
    }
    response = client.post("/risk", json=payload)
    assert response.status_code == 200
    data = response.json()

    scores_by_path = {s["path"]: s["risk_score"] for s in data["scores"]}
    assert set(scores_by_path) == {
        "src/HigherHistoryRisk.java",
        "src/LowerHistoryRisk.java",
    }
    assert all(0.0 <= score <= 1.0 for score in scores_by_path.values())


def test_risk_handles_missing_metrics_gracefully():
    """Verify that files with missing or partial metrics default to 0.0 without errors."""
    payload = {
        "files": [
            {
                "path": "src/EmptyMetrics.java",
                "metrics": {},
            },
            {
                "path": "src/PartialMetrics.java",
                "metrics": {"wmc": 5.0},
            },
        ]
    }
    response = client.post("/risk", json=payload)
    assert response.status_code == 200
    data = response.json()

    scores = data["scores"]
    assert len(scores) == 2
    assert scores[0]["path"] == "src/EmptyMetrics.java"
    assert 0.0 <= scores[0]["risk_score"] <= 1.0

    assert scores[1]["path"] == "src/PartialMetrics.java"
    assert 0.0 <= scores[1]["risk_score"] <= 1.0


def test_risk_batch_multiple_files_order_and_determinism():
    """Verify batch risk scoring preserves input file ordering and returns deterministic scores."""
    files = [
        {
            "path": f"src/Module{i}/Service.java",
            "metrics": {"wmc": float(i * 5), "loc": float(i * 100)},
        }
        for i in range(10)
    ]
    payload = {"files": files}

    first_response = client.post("/risk", json=payload).json()
    second_response = client.post("/risk", json=payload).json()

    assert first_response["model_version"] == second_response["model_version"]

    scores_1 = first_response["scores"]
    scores_2 = second_response["scores"]
    assert len(scores_1) == 10
    assert len(scores_2) == 10

    for i in range(10):
        assert scores_1[i]["path"] == files[i]["path"]
        assert scores_2[i]["path"] == files[i]["path"]
        assert scores_1[i]["risk_score"] == pytest.approx(scores_2[i]["risk_score"], abs=1e-5)
        assert 0.0 <= scores_1[i]["risk_score"] <= 1.0


def test_risk_empty_list():
    """Verify bug-risk endpoint with empty file list."""
    response = client.post("/risk", json={"files": []})
    assert response.status_code == 200
    assert response.json()["scores"] == []


def test_feature_vector_builder_canonical_order_and_defaults():
    """Verify build_vector constructs exact 13-feature array in canonical order and defaults missing values."""
    raw_metrics = {
        "wmc": 15.0,
        "loc": 300.0,
        "commits_90d": 8.0,
    }
    vec = build_vector(raw_metrics)

    assert len(vec) == len(FEATURE_ORDER) == 13
    assert vec[0] == 15.0  # wmc is index 0
    assert vec[1] == 0.0  # cbo is index 1 (missing -> 0.0)
    assert vec[6] == 300.0  # loc is index 6
    assert vec[9] == 8.0  # commits_90d is index 9


def test_fallback_risk_pipeline_direct_probabilities():
    """Verify _FallbackRiskPipeline directly produces valid probability pairs summing to 1.0."""
    pipeline = _FallbackRiskPipeline()
    vectors = [
        [50.0, 20.0, 5.0, 10.0, 30.0, 2.0, 1500.0, 8.0, 0.05, 40.0, 5.0, 365.0, 1.0],
        [2.0, 1.0, 1.0, 0.0, 3.0, 0.0, 30.0, 1.0, 0.2, 0.0, 1.0, 10.0, 10.0],
    ]
    probs = pipeline.predict_proba(vectors)
    preds = pipeline.predict(vectors)

    assert len(probs) == 2
    assert len(preds) == 2

    # High complexity / churn file
    assert probs[0][0] + probs[0][1] == pytest.approx(1.0)
    assert probs[0][1] > 0.5
    assert preds[0] == 1

    # Simple clean file
    assert probs[1][0] + probs[1][1] == pytest.approx(1.0)
    assert probs[1][1] < 0.5
    assert preds[1] == 0
