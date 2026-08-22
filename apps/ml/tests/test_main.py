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
