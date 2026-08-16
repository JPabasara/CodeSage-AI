"""Repository/project wire shapes (SRS FR-3, FR-4)."""

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


class RepoOut(ApiModel):
    id: str
    name: str
    owner: str
    visibility: Literal["public", "private"]
    url: str
    # No `source` field. v1.0 connects public repositories by pasted URL and that
    # is the only way in, so a column recording which of one way it was tells the
    # client nothing. It comes back when a second route exists (a GitHub App
    # installation), and the contract adds it then.
    default_branch: str
    connected_at: str

    # Derived under the active profile, like every other score. Absent until the
    # project has at least one finalized snapshot.
    latest_health: LatestHealthOut | None = None
