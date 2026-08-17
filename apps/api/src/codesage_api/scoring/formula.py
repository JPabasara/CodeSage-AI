"""The five factors of SRS FR-11, one function each.

    finding_priority = base_points(severity)      # system: the rule register
                     × category_weight[category]  # user:   5 sliders
                     × source_trust(finding)      # user:   trust slider
                     × churn_factor(file)         # evidence: how hot the file is
                     × risk_factor(file)          # model:  how bug-prone it is

    file_debt   = Σ finding_priority  (open findings only)
    repo_health = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
    grade       = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40

Read the factors as five separate questions — *how bad is it · what type is it ·
who found it · how hot is the file · how fragile is the file* — each with exactly
one owner, nothing counted twice.

Every constant is loaded from `scoring/config/*.yaml`, never written here (SRS
SP-8): recalibration must be a config change, not a release.

This module is pure arithmetic. No I/O, no database, no clock — wall-clock time is
not an input to scoring at all.
"""

from __future__ import annotations

from codesage_api.scoring.config_loader import get_scoring_config
from codesage_api.scoring.enums import Category, Grade, Severity, Source
from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding


def base_points(severity: Severity) -> float:
    """Look up the severity's worth. A lookup, not a judgement.

    Scoring never decides how bad a finding is — the detector already did that and
    stored it. This only decides how much that badness is *worth* under the active
    profile, which is why the badge a user sees and the ranking they see can never
    disagree: both read the same stored string.
    """
    return get_scoring_config().base_points[severity]


def churn_factor(facts: FileFacts) -> float:
    """1 + min(commits_90d, cap) / cap  →  range 1.0 – 2.0.

    The 90 days are measured backwards from the *scanned commit's committer date*,
    never from now() (SRS FR-11). That anchoring happens upstream in the extractor;
    by the time `commits_90d` reaches here it is already a fact about the commit.
    Had it been anchored to the clock, re-scanning the same SHA months later would
    produce a different score, breaking both reproducibility (REL-10) and the
    skip-if-unchanged shortcut (DBR-10).
    """
    cap = get_scoring_config().churn_cap
    return 1.0 + min(facts.commits_90d, cap) / cap


def risk_factor(facts: FileFacts, profile: Profile) -> float:
    """1 + ml_trust × risk_score  →  range 1.0 – 2.5.

    ML-2 multiplies rather than adds. SRS FR-10 gives it exactly two effects: it
    boosts the priority of findings already in that file, and it shows as a per-file
    risk level. It never creates debt of its own.

    The bound is a feature: max combined boost is churn 2.0 × risk 2.5 = 5×, which
    is less than the 8× spread between Low (1) and Critical (8). So the model can
    nudge ordering within a category but can never push a Low finding above a
    Critical one — the deterministic severity ranking cannot be inverted by ML.

    Consequence stated explicitly in FR-10: a risky file with zero findings
    contributes no debt and shows green, because every point of debt must trace to
    a finding the user can open. Risk stays visible as its own badge instead.

    Degraded mode: when the ML container is unreachable the worker stores
    risk_score = 0.0, so this returns 1.0 and no finding is boosted (SAD §6).
    """
    return 1.0 + ml_trust(profile) * facts.risk_score


def rule_trust(profile: Profile) -> float:
    """0.5 + s  →  0.5 … 1.5"""
    return 0.5 + profile.s


def ml_trust(profile: Profile) -> float:
    """1.5 − s  →  1.5 … 0.5"""
    return 1.5 - profile.s


def source_trust(finding: ScoringFinding, profile: Profile) -> float:
    """How far the team trusts whoever found this.

    One degree of freedom, which is exactly right: for ranking, only the *ratio*
    between the two sources matters. s = 0.5 gives both 1.0, so the default
    position changes nothing, and neither end ever reaches 0, so no slider position
    can silently suppress a finding.

    Security sits off the axis entirely — mechanism 2 of the FR-24 visibility
    floor. All security detection is deterministic, so without this exclusion the
    "trust the model" end would quietly halve every security finding, an inversion
    nobody would intend.
    """
    if finding.category is Category.SECURITY:
        return 1.0
    return rule_trust(profile) if finding.source is Source.RULE else ml_trust(profile)


def finding_priority(finding: ScoringFinding, facts: FileFacts, profile: Profile) -> float:
    """The five factors, multiplied. SRS FR-11."""
    return (
        base_points(finding.severity)
        * profile.weights[finding.category]
        * source_trust(finding, profile)
        * churn_factor(facts)
        * risk_factor(facts, profile)
    )


def repo_health(total_debt: float, kloc: float) -> float:
    """100 × (1 − min(1, total_debt / (k × KLOC)))  →  0 – 100.

    ⚠️ SRS FR-11: "k shall be calibrated against a set of reference repositories
    before release; the calibrated value and the calibration method shall be
    recorded in the SAD." The value in calibration.yaml is a placeholder and no
    grade should be quoted until that calibration has been run.
    """
    k = get_scoring_config().k
    if kloc <= 0:
        return 100.0
    return 100.0 * (1.0 - min(1.0, total_debt / (k * kloc)))


def grade(health: float) -> Grade:
    """A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40."""
    for threshold, letter in get_scoring_config().grade_bands:
        if health >= threshold:
            return Grade(letter)
    return Grade.E


def clamp_profile(weights: dict[Category, float], s: float) -> tuple[dict[Category, float], float]:
    """Clamp the five weights to 0.1–3.0 and s to 0–1. Server-side rule (SRS FR-20).

    The sliders already cannot exceed these bounds; that is a UI affordance, not
    the rule. `repo_health` is calibrated against `k`, so one unclamped weight from
    any client would make every stored grade incomparable with every other. Clamp
    silently and return what was stored rather than rejecting, so the client
    renders the corrected value instead of believing its own — FR-20 requires the
    response to carry the stored profile for exactly this reason.
    """
    cfg = get_scoring_config()
    lo, hi = cfg.weight_range
    s_lo, s_hi = cfg.s_range
    return (
        {c: min(hi, max(lo, w)) for c, w in weights.items()},
        min(s_hi, max(s_lo, s)),
    )
