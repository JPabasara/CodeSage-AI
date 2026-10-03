"""Branch wire shape."""

from __future__ import annotations

from codesage_api.schemas.base import ApiModel


class BranchOut(ApiModel):
    name: str
    is_default: bool
    head_commit_sha: str | None = None
    head_commit_at: str | None = None
