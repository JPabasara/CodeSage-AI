"""Branch listing (SRS FR-5)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from codesage_api.deps import get_db, get_workspace_id
from codesage_api.schemas import BranchOut
from codesage_api.services import repositories

router = APIRouter(prefix="/repos/{repo_id}", tags=["branches"])


@router.get("/branches", response_model=list[BranchOut])
def list_branches(
    repo_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
) -> list[BranchOut]:
    """Branches with head commit SHA and the default-branch flag.

    Analysis is per branch: each branch has its own snapshots and its own trend.

    Refreshed from the GitHub REST API. This is one of only two places the system
    calls REST at all — the pipeline itself runs off a clone.
    """
    return repositories.list_branches(db, workspace_id, repo_id)
