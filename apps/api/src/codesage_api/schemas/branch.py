"""Branch wire shape (SRS FR-5)."""

from __future__ import annotations

from codesage_api.schemas.base import ApiModel


class BranchOut(ApiModel):
    name: str
    is_default: bool
    # Full SHA; the UI shows the first 7. Sent whole because the client also uses it
    # to tell whether the displayed snapshot is current with the branch head.
    #
    # "head", not "last": this is where the branch is *now*, which is exactly what
    # the client compares against the snapshot it is showing. "Last" reads as "the
    # last one we scanned", which is a different commit and a different question.
    head_commit_sha: str | None = None
    head_commit_at: str | None = None
