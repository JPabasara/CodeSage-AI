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

from fastapi import FastAPI

from codesage_ml.schemas import (
    ClassifyRequest,
    ClassifyResponse,
    CommentPrediction,
    RiskRequest,
    RiskResponse,
    VersionResponse,
)

app = FastAPI(title="Code Sage AI — ML Inference", version="1.0.0")


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
    from codesage_ml.registry import load_satd_model

    model_info = load_satd_model()

    if not body.comments:
        return ClassifyResponse(predictions=[], model_version=model_info.version)

    texts = [c.text for c in body.comments]
    preds = model_info.artifact.predict(texts)

    predictions = []
    for comment, pred in zip(body.comments, preds):
        is_debt = (pred != "non_debt")
        category = pred if is_debt else None
        predictions.append(
            CommentPrediction(
                id=comment.id,
                is_debt=is_debt,
                category=category,
                confidence=1.0,
            )
        )

    return ClassifyResponse(predictions=predictions, model_version=model_info.version)


@app.post("/risk", response_model=RiskResponse)
def risk(body: RiskRequest) -> RiskResponse:
    """ML-2: per-file bug-proneness, 0–1 (SRS FR-10).

    Produces a score, never a finding, and assigns neither category nor severity.

    Feature order must match training exactly — `risk/features.py` owns that order
    and both sides import it, because a mismatch is silent: the model returns
    plausible numbers computed from the wrong columns.
    """
    raise NotImplementedError


@app.get("/version", response_model=VersionResponse)
def version() -> VersionResponse:
    """Deployed model versions.

    Recorded by the worker against every analysis attempt, so a snapshot always
    identifies what produced it. Without this, trend points computed before and
    after a retraining would be silently incomparable (AI-03, DBR-18).
    """
    from codesage_ml.registry import load_satd_model

    satd_info = load_satd_model()

    return VersionResponse(
        satd_model_version=satd_info.version,
        risk_model_version="not_implemented",
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
