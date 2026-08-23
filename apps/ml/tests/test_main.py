from fastapi.testclient import TestClient
from codesage_ml.main import app

client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version():
    response = client.get("/version")
    assert response.status_code == 200
    data = response.json()
    assert data["satd_model_version"] == "v1.0"
    assert data["risk_model_version"] == "not_implemented"


def test_classify_empty():
    response = client.post("/classify", json={"comments": []})
    assert response.status_code == 200
    data = response.json()
    assert data["predictions"] == []
    assert data["model_version"] == "v1.0"


def test_classify_comments():
    payload = {
        "comments": [
            {"id": "c1", "text": "TODO: fix memory leak when closing socket"},
            {"id": "c2", "text": "FIXME: temporary workaround for issue 42"},
            {"id": "c3", "text": "This method returns the calculated total sum."},
        ]
    }
    response = client.post("/classify", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["model_version"] == "v1.0"
    predictions = data["predictions"]
    assert len(predictions) == 3

    # Comment 1 & 2 are technical debt
    assert predictions[0]["id"] == "c1"
    assert predictions[0]["is_debt"] is True
    assert predictions[0]["category"] == "code/design_debt"

    assert predictions[1]["id"] == "c2"
    assert predictions[1]["is_debt"] is True
    assert predictions[1]["category"] == "code/design_debt"

    # Comment 3 is non-debt
    assert predictions[2]["id"] == "c3"
    assert predictions[2]["is_debt"] is False
    assert predictions[2]["category"] is None
