"""Wire shapes for the inference service."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


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


class FileFeaturesIn(BaseModel):
    path: str
    # Keyed by metric name; assembled into the ordered vector by risk/features.py.
    metrics: dict[str, float]


class RiskRequest(BaseModel):
    files: list[FileFeaturesIn]


class FileRisk(BaseModel):
    path: str
    risk_score: float  # 0.0 – 1.0


class RiskResponse(BaseModel):
    scores: list[FileRisk]
    model_version: str
    model_kind: Literal["trained", "heuristic"]


class VersionResponse(BaseModel):
    satd_model_version: str
    risk_model_version: str
