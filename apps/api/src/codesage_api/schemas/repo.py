"""Repository and project wire shapes."""

from __future__ import annotations

from typing import Literal

from pydantic import HttpUrl

from codesage_api.schemas.base import ApiModel
from codesage_api.scoring.enums import Grade


class ConnectRepoIn(ApiModel):
    """`POST /api/projects` — connect by pasted public URL."""

    url: HttpUrl


class LatestHealthOut(ApiModel):
    score: float
    grade: Grade
    delta: float


class SourceScopeConfigOut(ApiModel):
    test_path_patterns: list[str]
    production_path_overrides: list[str]


class UpdateSourceScopeConfigIn(ApiModel):
    test_path_patterns: list[str]
    production_path_overrides: list[str]


class RepoOut(ApiModel):
    id: str
    name: str
    owner: str
    visibility: Literal["public", "private"]
    url: str
    default_branch: str
    connected_at: str

    latest_health: LatestHealthOut | None = None
