"""Repository and project wire shapes."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, HttpUrl

from codesage_api.schemas.base import ApiModel
from codesage_api.schemas.health import HealthPointOut
from codesage_api.scoring.enums import Grade


class ConnectRepoIn(ApiModel):
    """`POST /api/projects` — connect by pasted public URL."""

    url: HttpUrl


class LatestHealthOut(ApiModel):
    score: float
    grade: Grade
    delta: float
    kloc: float | None = None
    finding_count: int | None = None
    red_issue_count: int | None = None
    scanned_at: str | None = None
    # Oldest first, at most 7, only scores already calculated.
    trend: list[HealthPointOut] = Field(default_factory=list, max_length=7)


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
