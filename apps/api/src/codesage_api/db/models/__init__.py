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

**The one rule that governs all of them: the schema stores facts, not scores.**
Priority, file debt, health score, grade, delta and the category breakdown are not
columns anywhere here. They are functions of the active profile, derived on every
read by ScoringEngine (SRS FR-21, DBR-21, DBR-23).

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
from codesage_api.db.models.source import (
    CodeSymbol,
    FileTreeNode,
    ProcessMetric,
    SourceFile,
    SourceLocation,
    StaticMetric,
)
from codesage_api.db.models.tenancy import Membership, SecurityAuditRecord, User, UserSession, Workspace

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
    "SecurityAuditRecord",
    "Snapshot",
    "SourceFile",
    "SourceLocation",
    "ScoringPreset",
    "ScoringProfile",
    "StaticMetric",
    "User",
    "UserSession",
    "Workspace",
]
