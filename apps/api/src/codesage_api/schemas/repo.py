"""Repository/project wire shapes (SRS FR-3, FR-4)."""

from __future__ import annotations

from pydantic import HttpUrl

from codesage_api.schemas.base import CamelModel
from codesage_api.scoring.enums import Grade


class ConnectRepoIn(CamelModel):
    """`POST /api/projects` — connect by pasted public URL."""

    url: HttpUrl


class LatestHealthOut(CamelModel):
    score: float
    grade: Grade
    delta: float


class RepoOut(CamelModel):
    id: str
    name: str
    owner: str
    visibility: str  # v1.0 is always "public"
    url: str
    default_branch: str
    connected_at: str

    # Derived under the active profile, like every other score. Absent until the
    # project has at least one finalized snapshot.
    latest_health: LatestHealthOut | None = None
