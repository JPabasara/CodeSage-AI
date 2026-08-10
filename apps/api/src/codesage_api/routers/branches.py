"""Branch listing (SRS FR-5)."""

from __future__ import annotations

from fastapi import APIRouter

from codesage_api.schemas import BranchOut

router = APIRouter(prefix="/repos/{repo_id}", tags=["branches"])


@router.get("/branches", response_model=list[BranchOut])
def list_branches(repo_id: str) -> list[BranchOut]:
    """Branches with head commit SHA and the default-branch flag.

    Analysis is per branch: each branch has its own snapshots and its own trend.

    Refreshed from the GitHub REST API using ETag conditional requests, so a repeat
    call usually costs no rate-limit quota. This is one of only two places the
    system calls REST at all — the pipeline itself runs off a clone.
    """
    raise NotImplementedError
