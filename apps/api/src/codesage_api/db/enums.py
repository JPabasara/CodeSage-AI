from enum import Enum


class ValueEnum(str, Enum):
    pass


class Theme(ValueEnum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class RepositoryPlatform(ValueEnum):
    GITHUB = "github"


class RepositoryVisibility(ValueEnum):
    PUBLIC = "public"
    PRIVATE = "private"


class RepositoryConnectionStatus(ValueEnum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"


class AnalysisTriggerType(ValueEnum):
    MANUAL = "manual"


class AnalysisStatus(ValueEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


class MembershipStatus(ValueEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    INVITED = "invited"


class CodeSymbolType(ValueEnum):
    CLASS = "class"
    METHOD = "method"
    FUNCTION = "function"
    FIELD = "field"


class FindingSource(ValueEnum):
    RULE = "rule"
    SATD = "satd"


class Severity(ValueEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class MLModelType(ValueEnum):
    SATD = "satd"
    BUG_RISK = "bug_risk"


class ModelDeploymentStatus(ValueEnum):
    EVALUATING = "evaluating"
    DEPLOYED = "deployed"
    RETIRED = "retired"


class FileTreeNodeType(ValueEnum):
    FILE = "file"
    FOLDER = "folder"


class ScoringPresetType(ValueEnum):
    BALANCED = "balanced"
    SECURITY_FIRST = "security_first"
    DELIVERY_SPEED = "delivery_speed"
