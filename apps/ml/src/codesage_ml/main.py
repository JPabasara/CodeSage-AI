"""ML inference service — the two models behind one HTTP surface (SAD §7).

Called by Celery workers only, over the private network. The API process never
performs inference.

**Both models live in this one container**, which is why SAD §6 decision 11 says
they are reachable or unreachable together. When this service is down the worker
still persists a valid snapshot: rule findings only, every risk score 0.0. That is
the whole degraded-mode contract, and it is the reason this service is allowed to
be a single point of failure without being a single point of *outage*.

**Inference only.** Training happens offline, in `training/`, and is never
reachable from here (AI-05). This process loads versioned artifacts and answers
questions; it never learns.
"""

from __future__ import annotations

import random

from fastapi import FastAPI

from codesage_ml.schemas import (
    ClassifyRequest,
    ClassifyResponse,
    CommentPrediction,
    RiskRequest,
    RiskResponse,
    FileRisk,
    VersionResponse,
)
from codesage_ml.satd.labels import DATASET_TO_CATEGORY

app = FastAPI(title="Code Sage ML API (Mock)", version="1.0.0")

MOCK_VERSION = "mock-1.0.0"


@app.post("/classify", response_model=ClassifyResponse)
def classify(body: ClassifyRequest) -> ClassifyResponse:
    """ML-1: is each comment debt, and if so of what type (SRS FR-9).

    Predicts one of four categories — code-design, requirement, documentation,
    test — plus the negative class. **`security` is never predicted**: it is not in
    the SATDAUG training data and only the rule engine emits it (FR-9.3).

    **Does not predict severity, and cannot.** A supervised model predicts only
    what its training data labels, and the dataset labels categories. Severity is
    assigned downstream by the deterministic marker table (FR-9.2).

    Batched because a repository has tens of thousands of comments and a
    per-comment round trip would dominate scan time.
    """
    predictions = []
    categories = list(DATASET_TO_CATEGORY.values()) + [None]
    
    for comment in body.comments:
        random.seed(comment.id)
        cat = random.choice(categories)
        is_debt = cat is not None
        predictions.append(
            CommentPrediction(
                id=comment.id,
                is_debt=is_debt,
                category=cat,
                confidence=round(random.uniform(0.5, 0.99), 2) if is_debt else 0.0
            )
        )
        
    return ClassifyResponse(predictions=predictions, model_version=MOCK_VERSION)

@app.post("/risk", response_model=RiskResponse)
def risk(body: RiskRequest) -> RiskResponse:
    """ML-2: per-file bug-proneness, 0–1 (SRS FR-10).

    Produces a score, never a finding, and assigns neither category nor severity.

    Feature order must match training exactly — `risk/features.py` owns that order
    and both sides import it, because a mismatch is silent: the model returns
    plausible numbers computed from the wrong columns.
    """
    scores = []
    for file in body.files:
        random.seed(file.path)
        scores.append(
            FileRisk(
                path=file.path,
                risk_score=round(random.uniform(0.0, 1.0), 2)
            )
        )
        
    return RiskResponse(scores=scores, model_version=MOCK_VERSION)
@app.get("/version", response_model=VersionResponse)
def version() -> VersionResponse:
    """Deployed model versions.
    
    Allows the orchestrator to snapshot which model produced an analysis without
    parsing it out of every prediction list.
    """
    return VersionResponse(
        satd_model_version=MOCK_VERSION,
        risk_model_version=MOCK_VERSION,
    )

@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
