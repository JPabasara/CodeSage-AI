

from __future__ import annotations

from codesage_api.scoring.config_loader import get_scoring_config
from codesage_api.scoring.enums import Category, Grade, Severity, Source
from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding


def base_points(severity: Severity) -> float:
    return get_scoring_config().base_points[severity]


def churn_factor(facts: FileFacts) -> float:

    cap = get_scoring_config().churn_cap
    return 1.0 + min(facts.commits_90d, cap) / cap


def risk_factor(facts: FileFacts, profile: Profile) -> float:
  
    return 1.0 + ml_trust(profile) * facts.risk_score


def rule_trust(profile: Profile) -> float:
    """0.5 + s  →  0.5 … 1.5"""
    return 0.5 + profile.s


def ml_trust(profile: Profile) -> float:
    """1.5 − s  →  1.5 … 0.5"""
    return 1.5 - profile.s


def source_trust(finding: ScoringFinding, profile: Profile) -> float:
 
    if finding.category is Category.SECURITY:
        return 1.0
    return rule_trust(profile) if finding.source is Source.RULE else ml_trust(profile)


def finding_priority(finding: ScoringFinding, facts: FileFacts, profile: Profile) -> float:

    return (
        base_points(finding.severity)
        * profile.weights[finding.category]
        * source_trust(finding, profile)
        * churn_factor(facts)
        * risk_factor(facts, profile)
    )


def repo_health(total_debt: float, kloc: float) -> float:

    k = get_scoring_config().k
    if kloc <= 0:
        return 100.0
    return 100.0 * (1.0 - min(1.0, total_debt / (k * kloc)))


def grade(health: float) -> Grade:

    for threshold, letter in get_scoring_config().grade_bands:
        if health >= threshold:
            return Grade(letter)
    return Grade.E


def clamp_profile(weights: dict[Category, float], s: float) -> tuple[dict[Category, float], float]:

    cfg = get_scoring_config()
    lo, hi = cfg.weight_range
    s_lo, s_hi = cfg.s_range
    return (
        {c: min(hi, max(lo, w)) for c, w in weights.items()},
        min(s_hi, max(s_lo, s)),
    )
