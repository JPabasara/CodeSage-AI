"""Canonical policy for deciding which stored source facts affect health.

Detection, persistence and display are deliberately separate from this policy:
an excluded file and its findings remain available to the dashboard.
"""

from __future__ import annotations

HEALTH_SCOPE_POLICY_VERSION = "health-scope-v1"


def contributes_to_health(source_scope: str, *, include_test_findings: bool) -> bool:
    """Return whether both debt and LOC from this scope contribute to health.

    Generated classification is intentionally conservative and happens before
    this function. Unknown/example files remain included because excluding them
    without reliable ownership information would silently improve a score.
    """
    if source_scope == "generated":
        return False
    if source_scope == "test":
        return include_test_findings
    return True

