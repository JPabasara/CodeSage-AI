from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from codesage_ml.main import app, classify
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
    """Verify version endpoint returns deployed SATD model version."""
    response = client.get("/version")
    assert response.status_code == 200
    data = response.json()
    assert data["satd_model_version"] in ("v1.0", "satd-1.0.0")
    assert data["risk_model_version"] == "mock-1.0.0"


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
            comments=[{"id": f"{tag}-{i}", "text": "TODO: fix this" if i % 2 == 0 else "clean code"} for i in range(40)]
        )
        return {
            p.id: (p.is_debt, p.category, p.confidence)
            for p in classify(request).predictions
        }

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
    assert data["model_version"] == "mock-1.0.0"

    scores = data["scores"]
    assert len(scores) == 1
    score = scores[0]
    assert score["path"] == "src/main.py"
    assert 0.0 <= score["risk_score"] <= 1.0


def test_risk_empty_list():
    """Verify bug-risk endpoint with empty file list."""
    response = client.post("/risk", json={"files": []})
    assert response.status_code == 200
    assert response.json()["scores"] == []
