from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from codesage_ml.main import app, classify
from codesage_ml.schemas import ClassifyRequest

client = TestClient(app)

# Seeding is per-id, so these are fixed. `c1` lands on the negative class and `c2`
# on a category — chosen deliberately so `test_classify` exercises BOTH sides of
# its own if/else. Pinned in `test_classify_covers_both_branches` below, because
# when both ids happened to be debt the negative-class assertions were dead code
# and nobody could tell from a green run.
NON_DEBT_ID = "c1"
DEBT_ID = "c2"

def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_version():
    response = client.get("/version")
    assert response.status_code == 200
    data = response.json()
    assert data["satd_model_version"] == "mock-1.0.0"
    assert data["risk_model_version"] == "mock-1.0.0"

def test_classify():
    payload = {
        "comments": [
            {"id": NON_DEBT_ID, "text": "regular comment"},
            {"id": DEBT_ID, "text": "TODO: fix this"},
        ]
    }
    response = client.post("/classify", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert "model_version" in data
    assert data["model_version"] == "mock-1.0.0"
    
    predictions = data["predictions"]
    assert len(predictions) == 2
    
    for i, pred in enumerate(predictions):
        assert pred["id"] == payload["comments"][i]["id"]
        
        if not pred["is_debt"]:
            assert pred["category"] is None
            assert pred["confidence"] == 0.0
        else:
            assert pred["category"] is not None
            assert pred["confidence"] > 0.0
            
        assert pred["category"] != "security"

def test_classify_covers_both_branches():
    """Guards the test above, not the endpoint.

    `test_classify` has an if/else for debt and non-debt, and with seeded ids only
    the branches those two ids happen to hit ever run. If a weight or a label
    changes and both land on the same side, half of "category is null exactly when
    is_debt is false" silently stops being checked. This fails loudly instead.
    """
    payload = {"comments": [{"id": NON_DEBT_ID, "text": "a"}, {"id": DEBT_ID, "text": "b"}]}
    predictions = client.post("/classify", json=payload).json()["predictions"]

    outcomes = {p["id"]: p["is_debt"] for p in predictions}
    assert outcomes[NON_DEBT_ID] is False, f"{NON_DEBT_ID} no longer seeds to non-debt"
    assert outcomes[DEBT_ID] is True, f"{DEBT_ID} no longer seeds to debt"


def test_same_id_gives_the_same_answer():
    """The point of seeding: Chamodh can assert on fixed values, and the demo
    shows the same numbers tomorrow."""
    payload = {"comments": [{"id": f"c{i}", "text": "t"} for i in range(20)]}

    first = client.post("/classify", json=payload).json()["predictions"]
    second = client.post("/classify", json=payload).json()["predictions"]

    assert first == second


def test_concurrent_requests_do_not_interfere():
    """Regression test for the global-RNG race.

    `random.seed()` mutates process-wide state, and FastAPI runs a sync `def`
    endpoint in a threadpool — so two scans at once interleave and one request
    draws against the other's seed. It reproduced as the same comment id coming
    back `requirement` alone and `documentation` under load.

    Calls the endpoint function directly: TestClient serialises requests, so it
    cannot exercise this. PERF-07 runs three workers, so this is the normal case.
    """

    def predict(tag: str) -> dict[str, tuple[bool, str | None, float]]:
        request = ClassifyRequest(
            comments=[{"id": f"{tag}-{i}", "text": "t"} for i in range(40)]
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
    """About 15% of comments are debt, as in SATDAUG (see satd/labels.py).

    An even draw over the four categories plus the negative class would make 80%
    of every repository debt. The pipeline Chamodh builds against would then be
    tuned for a load the trained model never produces — and the demo dashboard
    would drown in findings.

    Deterministic, not statistical: the ids are fixed, so this cannot flake.
    """
    payload = {"comments": [{"id": f"id-{i}", "text": "t"} for i in range(2000)]}
    predictions = client.post("/classify", json=payload).json()["predictions"]

    debt_rate = sum(p["is_debt"] for p in predictions) / len(predictions)
    assert 0.10 <= debt_rate <= 0.22, f"debt rate {debt_rate:.1%} — expected about 15%"


def test_classify_empty_list():
    response = client.post("/classify", json={"comments": []})
    assert response.status_code == 200
    assert response.json()["predictions"] == []


def test_risk():
    payload = {
        "files": [
            {
                "path": "src/main.py",
                "metrics": {
                    "wmc": 10.0,
                    "commits_90d": 5.0,
                    "file_age_days": 15.0,
                    "author_count": 2.0,
                    "cbo": 5.0
                }
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
    response = client.post("/risk", json={"files": []})
    assert response.status_code == 200
    assert response.json()["scores"] == []
