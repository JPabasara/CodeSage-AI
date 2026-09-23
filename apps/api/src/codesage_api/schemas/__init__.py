"""Pydantic request/response models — the wire shapes.

`docs/api/openapi.yaml` is the single source of truth for FE⇄BE shapes, and
`apps/web/src/lib/types/api.ts` is generated from it. Changing a shape means
changing the contract first, then both sides.

Field names are **snake_case on the wire** (see `ApiModel`), the same spelling
used by the contract, the SRS and the database columns — so no one has to
remember which side of the wire they are on.
"""

from codesage_api.schemas.auth import (
    CreateWorkspaceIn,
    SessionOut,
    SwitchWorkspaceIn,
    UpdateWorkspaceIn,
    WorkspaceSummaryOut,
)
from codesage_api.schemas.base import ApiModel
from codesage_api.schemas.branch import BranchOut
from codesage_api.schemas.finding import FindingOut
from codesage_api.schemas.health import (
    CategoryBreakdownItemOut,
    FileScoreOut,
    HealthPointOut,
    HealthReportOut,
    TreeNodeOut,
)
from codesage_api.schemas.profile import (
    CategoryWeights,
    CategoryWeightsPatch,
    CreateProfileIn,
    ProjectProfileOut,
    ScoreProfileIn,
    ScoreProfileOut,
    SelectProfileIn,
    UpdateProfileIn,
)
from codesage_api.schemas.repo import ConnectRepoIn, LatestHealthOut, RepoOut
from codesage_api.schemas.scan import ScanStatusOut, ScanSummaryOut, StartScanIn

__all__ = [
    "ApiModel",
    "BranchOut",
    "CategoryBreakdownItemOut",
    "CategoryWeights",
    "CategoryWeightsPatch",
    "ConnectRepoIn",
    "CreateProfileIn",
    "CreateWorkspaceIn",
    "FileScoreOut",
    "FindingOut",
    "HealthPointOut",
    "HealthReportOut",
    "LatestHealthOut",
    "ProjectProfileOut",
    "RepoOut",
    "ScanStatusOut",
    "ScanSummaryOut",
    "ScoreProfileIn",
    "ScoreProfileOut",
    "SelectProfileIn",
    "SessionOut",
    "StartScanIn",
    "SwitchWorkspaceIn",
    "TreeNodeOut",
    "UpdateProfileIn",
    "UpdateWorkspaceIn",
    "WorkspaceSummaryOut",
]
