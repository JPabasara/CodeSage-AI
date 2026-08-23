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

from codesage_ml.satd.labels import DATASET_TO_CATEGORY
from codesage_ml.schemas import (
    ClassifyRequest,
    ClassifyResponse,
    CommentPrediction,
    FileRisk,
    RiskRequest,
    RiskResponse,
    VersionResponse,
)

app = FastAPI(title="Code Sage AI — ML Inference", version="1.0.0")

#: Reported by every endpoint until a trained artifact replaces this service.
#: One constant, so a real version cannot be rolled out to two of the three.
MOCK_VERSION = "mock-1.0.0"

#: The four categories ML-1 may predict, plus the negative class as `None`.
#: `security` is absent by construction — it is not in SATDAUG and only the rule
#: engine emits it (FR-9.3).
_CATEGORIES: list[str | None] = [*DATASET_TO_CATEGORY.values(), None]

#: SATDAUG's own class counts, in `_CATEGORIES` order — see `satd/labels.py`.
#:
#: Weighting matters more than it looks. An even draw over five options makes 80%
#: of comments debt; the real corpus is about 15%. On a repository with tens of
#: thousands of comments that is the difference between a believable dashboard and
#: one drowning in findings, and Chamodh would be tuning the pipeline against a
#: load the trained model will never produce.
_CLASS_COUNTS = [2703, 2271, 2635, 2701, 58204]


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

    for comment in body.comments:
        # A generator per comment, NOT `random.seed()`. Seeding mutates
        # process-global state, and FastAPI runs a sync `def` endpoint in a
        # threadpool — so two concurrent scans interleave, one request draws
        # against another's seed, and the same comment id yields different
        # answers. That defeats the only reason to seed at all. `PERF-07` runs
        # three workers, so concurrent calls are the expected case, not the edge.
        #
        # Seeding on a str is stable across processes: since 3.2 `Random(str)`
        # hashes with sha512 rather than `hash()`, so PYTHONHASHSEED cannot move
        # it and a demo replays identically tomorrow.
        rng = random.Random(comment.id)
        category = rng.choices(_CATEGORIES, weights=_CLASS_COUNTS)[0]
        is_debt = category is not None
        predictions.append(
            CommentPrediction(
                id=comment.id,
                is_debt=is_debt,
                category=category,
                confidence=rng.uniform(0.6, 0.99) if is_debt else 0.0,
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
        # Keyed on the path, for the same reason as `/classify`: a file's score
        # must not change because another scan happened to run at the same time.
        rng = random.Random(file.path)
        scores.append(FileRisk(path=file.path, risk_score=rng.uniform(0.0, 1.0)))

    return RiskResponse(scores=scores, model_version=MOCK_VERSION)


@app.get("/version", response_model=VersionResponse)
def version() -> VersionResponse:
    """Deployed model versions.

    Recorded by the worker against every analysis attempt, so a snapshot always
    identifies what produced it. Without this, trend points computed before and
    after a retraining would be silently incomparable (AI-03, DBR-18).
    """
    return VersionResponse(
        satd_model_version=MOCK_VERSION,
        risk_model_version=MOCK_VERSION,
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
