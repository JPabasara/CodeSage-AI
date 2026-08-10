"""Pydantic request/response models — the wire shapes.

These MUST mirror `apps/web/src/lib/types/index.ts`, which SRS SP-1 makes the
single source of truth for FE⇄BE shapes; changes go through a reviewed PR on both
sides. Field names are camelCase on the wire (see `CamelModel`) because the
contract is TypeScript-first.

⚠️ The contract file is currently at its pre-CR-001 state. Reconcile before wiring
the frontend — see the note in `scoring/enums.py`.
"""

from codesage_api.schemas.base import CamelModel
from codesage_api.schemas.branch import BranchOut
from codesage_api.schemas.finding import FindingOut
from codesage_api.schemas.health import (
    CategoryBreakdownItemOut,
    FileScoreOut,
    HealthPointOut,
    HealthReportOut,
    TreeNodeOut,
)
from codesage_api.schemas.profile import ScoreProfileIn, ScoreProfileOut
from codesage_api.schemas.repo import ConnectRepoIn, RepoOut
from codesage_api.schemas.scan import ScanStatusOut, ScanSummaryOut, StartScanIn

__all__ = [
    "BranchOut",
    "CamelModel",
    "CategoryBreakdownItemOut",
    "ConnectRepoIn",
    "FileScoreOut",
    "FindingOut",
    "HealthPointOut",
    "HealthReportOut",
    "RepoOut",
    "ScanStatusOut",
    "ScanSummaryOut",
    "ScoreProfileIn",
    "ScoreProfileOut",
    "StartScanIn",
    "TreeNodeOut",
]
