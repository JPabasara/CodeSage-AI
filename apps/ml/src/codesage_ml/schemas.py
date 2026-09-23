"""Wire shapes for the inference service."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# ML-1: SATD
# ---------------------------------------------------------------------------


class CommentIn(BaseModel):
    id: str  # correlates the result back to the extracted comment
    text: str


class ClassifyRequest(BaseModel):
    comments: list[CommentIn]


class CommentPrediction(BaseModel):
    id: str
    is_debt: bool

    # One of the four predictable categories, or null when is_debt is false.
    # Never "security" — that is rule-engine territory.
    category: str | None

    confidence: float


class ClassifyResponse(BaseModel):
    predictions: list[CommentPrediction]
    model_version: str


# ---------------------------------------------------------------------------
# ML-2: Bug-proneness
# ---------------------------------------------------------------------------


class ClassFeaturesIn(BaseModel):
    """Features for one Java class."""

    path: str
    class_name: str

    # Named feature values. risk/features.py owns validation and ordering.
    metrics: dict[str, float]


class RiskRequest(BaseModel):
    """Batch of class-level observations for ML-2."""

    classes: list[ClassFeaturesIn]


class ClassRisk(BaseModel):
    """Bug-proneness probability predicted for one Java class."""

    path: str
    class_name: str

    risk_score: float = Field(
        ge=0.0,
        le=1.0,
    )


class RiskResponse(BaseModel):
    scores: list[ClassRisk]
    model_version: str
    model_kind: Literal["trained", "heuristic"]


# ---------------------------------------------------------------------------
# Service metadata
# ---------------------------------------------------------------------------


class VersionResponse(BaseModel):
    satd_model_version: str
    risk_model_version: str