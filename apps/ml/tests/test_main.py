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
    assert "satd_model_version" in data
    assert "risk_model_version" in data

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
    assert "predictions" in data
    assert len(data["predictions"]) == 2
    assert "model_version" in data
    
    # Verify shape of first prediction
    pred = data["predictions"][0]
    assert "id" in pred
    assert "is_debt" in pred
    assert "category" in pred
    assert "confidence" in pred
