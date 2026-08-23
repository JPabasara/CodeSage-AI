import pytest
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
    assert data["satd_model_version"] == "mock-1.0.0"
    assert data["risk_model_version"] == "mock-1.0.0"

def test_classify():
    payload = {
        "comments": [
            {"id": "c1", "text": "TODO: fix this"},
            {"id": "c2", "text": "regular comment"}
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
