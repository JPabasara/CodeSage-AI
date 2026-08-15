
from __future__ import annotations

from fastapi import APIRouter

from codesage_api.schemas import HealthReportOut

router = APIRouter(prefix="/repos/{repo_id}", tags=["dashboard"])


@router.get("/health", response_model=HealthReportOut)
def get_health_report(repo_id: str, branch: str) -> HealthReportOut:
    raise NotImplementedError
