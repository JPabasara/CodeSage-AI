"""ORM models. Importing this package registers every table on Base.metadata,
which is what makes Alembic's --autogenerate see the full schema.

Grouped to match the four domains of SAD §9 Data View:

    tenancy.py     — Workspace, User, Membership, SecurityAuditRecord
    repository.py  — Repository, Branch
    analysis.py    — AnalysisAttempt, Snapshot
    source.py      — SourceFile, FileTreeNode, CodeSymbol, SourceLocation,
                     StaticMetric, ProcessMetric
    finding.py     — Finding, DebtCategory
    ml.py          — SATDPrediction, BugRiskPrediction, MLModelVersion
    provenance.py  — AnalysisEngineVersion, AnalysisEngineModelVersion
    rules.py       — RuleDefinition, SATDMarkerPattern
    profile.py     — ScoringProfile, ScoringPreset

SnapshotScore is the sole exception to fact storage: it is a deletable derived
cache stamped with the complete profile fingerprint and scoring-engine version.
Snapshots and findings remain authoritative; deleting every cache row changes
performance only.

**Not in the v1.0 schema, deliberately:** no suppression or finding-action table
(v1.0 is view-only, FR-17b); no webhook-event table (scans are user-initiated
only, FR-6); no role or permission tables beyond Membership.role (RBAC is v2,
DBR-5).
"""

from codesage_api.db.models.analysis import AnalysisAttempt, Snapshot
from codesage_api.db.models.finding import DebtCategory, Finding
from codesage_api.db.models.ml import BugRiskPrediction, MLModelVersion, SATDPrediction
from codesage_api.db.models.profile import ScoringPreset, ScoringProfile
from codesage_api.db.models.provenance import AnalysisEngineModelVersion, AnalysisEngineVersion
from codesage_api.db.models.repository import Branch, Repository
from codesage_api.db.models.rules import RuleDefinition, SATDMarkerPattern
from codesage_api.db.models.score import SnapshotScore
from codesage_api.db.models.source import (
    CodeSymbol,
    FileTreeNode,
    ProcessMetric,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.models.tenancy import (
    Membership,
    SecurityAuditRecord,
    User,
    UserSession,
    Workspace,
)

__all__ = [
    "AnalysisAttempt",
    "AnalysisEngineModelVersion",
    "AnalysisEngineVersion",
    "Branch",
    "BugRiskPrediction",
    "CodeSymbol",
    "DebtCategory",
    "FileTreeNode",
    "Finding",
    "MLModelVersion",
    "Membership",
    "ProcessMetric",
    "Repository",
    "RuleDefinition",
    "SATDMarkerPattern",
    "SATDPrediction",
    "ScoringPreset",
    "ScoringProfile",
    "SecurityAuditRecord",
    "Snapshot",
    "SnapshotScore",
    "SourceFile",
    "SourceLocation",
    "StaticMetric",
    "User",
    "UserSession",
    "Workspace",
]
