from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from codesage_api.authorization.routes import require_health_read
from codesage_api.deps import get_db, get_workspace_id
from codesage_api.schemas import FindingPageOut, HealthReportOut
from codesage_api.schemas.health import CalibrationRecordOut
from codesage_api.services import dashboard, response_cache
from codesage_api.services.dashboard import PreparedRead

router = APIRouter(prefix="/repos/{repo_id}", tags=["dashboard"])

NOT_MODIFIED = {304: {"description": "The copy the browser holds (If-None-Match) is current."}}


def _cached_json(
    request: Request, model: type[BaseModel], prepared: PreparedRead[BaseModel]
) -> Response:
    """304 when the browser already has it, else the cached or freshly built bytes.

    Authorization and tenancy were checked while preparing, before any of this.
    """
    etag = response_cache.etag_for(model, prepared.version())
    headers = {"ETag": etag, "Cache-Control": response_cache.CACHE_CONTROL}
    if response_cache.matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    body = response_cache.responses.get(etag)
    if body is None:
        body = prepared.build().model_dump_json().encode()
        response_cache.responses.put(etag, body)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get(
    "/health",
    response_model=HealthReportOut,
    responses=NOT_MODIFIED,
    dependencies=[Depends(require_health_read)],
)
def get_health_report(
    request: Request,
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    snapshot_id: uuid.UUID | None = None,
    include_findings: bool = True,
) -> Response:
    """Return the latest or selected finalized snapshot, scored on this read."""
    prepared = dashboard.prepare_health_report(
        db,
        workspace_id,
        repo_id,
        branch,
        snapshot_id,
        include_findings=include_findings,
    )
    return _cached_json(request, HealthReportOut, prepared)


@router.get(
    "/health/findings",
    response_model=FindingPageOut,
    responses=NOT_MODIFIED,
    dependencies=[Depends(require_health_read)],
)
def get_findings_page(
    request: Request,
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    snapshot_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    source: Literal["rule", "satd"] | None = None,
    severity: Literal["critical", "high", "medium", "low"] | None = None,
    category: Literal["code-design", "requirement", "documentation", "test", "security"]
    | None = None,
    status: Literal["open", "done"] | None = None,
) -> Response:
    prepared = dashboard.prepare_findings_page(
        db,
        workspace_id,
        repo_id,
        branch,
        snapshot_id,
        limit=limit,
        offset=offset,
        source=source,
        severity=severity,
        category=category,
        status=status,
    )
    return _cached_json(request, FindingPageOut, prepared)


@router.get(
    "/health/calibration-export",
    response_model=CalibrationRecordOut,
    dependencies=[Depends(require_health_read)],
)
def get_calibration_export(
    repo_id: uuid.UUID,
    branch: str,
    db: Annotated[Session, Depends(get_db)],
    workspace_id: Annotated[uuid.UUID, Depends(get_workspace_id)],
    snapshot_id: uuid.UUID | None = None,
) -> CalibrationRecordOut:
    """Export one completed scan using the exact cached production score scope."""
    return dashboard.build_calibration_export(db, workspace_id, repo_id, branch, snapshot_id)
