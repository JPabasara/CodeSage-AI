"""Branch wire shape (SRS FR-5)."""

from __future__ import annotations

from codesage_api.schemas.base import CamelModel


class BranchOut(CamelModel):
    name: str
    is_default: bool
    # Full SHA; the UI shows the first 7. Sent whole because the client also uses it
    # to tell whether the displayed snapshot is current with the branch head.
    last_commit_sha: str
    last_commit_at: str | None = None
