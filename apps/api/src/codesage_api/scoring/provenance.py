"""Versioned, machine-readable description of health-scoring semantics."""

from __future__ import annotations

from codesage_api.scoring.cache import SCORING_ENGINE_VERSION, profile_payload
from codesage_api.scoring.config_loader import get_scoring_config
from codesage_api.scoring.models import Profile
from codesage_api.scoring.scope import HEALTH_SCOPE_POLICY_VERSION

HEALTH_SCORING_PROFILE_ID = "health-scoring-profile-v1"


def health_scoring_profile(
    profile: Profile,
    *,
    analysis_engine: dict[str, object] | None = None,
    model_versions: dict[str, object] | None = None,
) -> dict[str, object]:
    """Describe the actual inputs and policies that produced a health score.

    Runtime scan provenance is accepted separately because PMD and model
    versions belong to a completed snapshot, not to global scoring constants.
    """
    config = get_scoring_config()
    return {
        "profile_id": HEALTH_SCORING_PROFILE_ID,
        "scoring_engine_version": SCORING_ENGINE_VERSION,
        "severity_base_points": {
            severity.value: points for severity, points in config.base_points.items()
        },
        "active_profile": profile_payload(profile),
        "trust_multipliers": {
            "rule": 0.5 + profile.s,
            "satd_ml": 1.5 - profile.s,
            "security_override": 1.0,
        },
        "churn": {
            "formula": "1 + min(commits_90d, cap) / cap",
            "cap_commits": config.churn_cap,
            "window_days": 90,
            "source": "persisted per-file ProcessMetric.commits_90d",
        },
        "risk_multiplier": {
            "formula": "1 + ml_trust * finding_risk_score",
            "risk_score_range": [0.0, 1.0],
        },
        "health_scope": {
            "policy_version": HEALTH_SCOPE_POLICY_VERSION,
            "production": "included",
            "test": "included only when active_profile.include_test_findings is true",
            "generated": "excluded from both debt and LOC",
            "unknown_and_example": "included",
            "vendor_third_party": (
                "included because no reliable dedicated classification exists"
            ),
        },
        "loc": {
            "method": "sum of included CK per-file loc static metrics",
            "kloc_conversion": "LOC / 1000",
        },
        "health_formula": {
            "version": "linear-debt-density-v1",
            "formula": "100 * (1 - min(1, (D / KLOC) / k))",
            "current_k": config.k,
            "k_status": "placeholder_not_calibrated",
        },
        "analysis_engine": analysis_engine or {},
        "model_versions": model_versions or {},
    }

