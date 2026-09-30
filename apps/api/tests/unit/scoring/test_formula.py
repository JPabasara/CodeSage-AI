"""Unit tests for the scoring formula (SRS FR-11).

These run with **no database, no broker, no HTTP** — that is the property the
`scoring is pure` import contract exists to protect, and it is what SP-11 means by
an exactly testable scoring path.

The stubs below are written against the current signatures so they fail loudly
when `engine.score` is implemented, rather than passing vacuously.
"""

from __future__ import annotations

import pytest

from codesage_api.scoring import formula
from codesage_api.scoring.enums import Category, Severity, Source
from codesage_api.scoring.models import FileFacts, Profile, ScoringFinding


@pytest.fixture
def balanced() -> Profile:
    """All weights 1.0, s = 0.5 — the default lens, which changes nothing."""
    return Profile(weights={c: 1.0 for c in Category}, s=0.5)


def test_base_points_are_the_appendix_c_values() -> None:
    assert formula.base_points(Severity.CRITICAL) == 8
    assert formula.base_points(Severity.HIGH) == 5
    assert formula.base_points(Severity.MEDIUM) == 3
    assert formula.base_points(Severity.LOW) == 1


def test_churn_factor_is_bounded_1_to_2() -> None:
    assert formula.churn_factor(FileFacts("a.java", 0.0, 0,1000)) == 1.0
    assert formula.churn_factor(FileFacts("a.java", 0.0, 20,1000)) == 2.0
    # Saturates: 100 commits is not worth more than 20.
    assert formula.churn_factor(FileFacts("a.java", 0.0, 100,1000)) == 2.0


def test_risk_factor_is_bounded_1_to_2_5(balanced: Profile) -> None:
    assert formula.risk_factor(0.0, balanced) == 1.0
    trusting_model = Profile(weights=balanced.weights, s=0.0)  # ml_trust = 1.5
    assert formula.risk_factor(1.0, trusting_model) == 2.5


def test_trust_slider_default_position_is_neutral(balanced: Profile) -> None:
    """s = 0.5 gives both sources 1.0, so the default changes no ranking."""
    assert formula.rule_trust(balanced) == 1.0
    assert formula.ml_trust(balanced) == 1.0


def test_neither_trust_end_can_silence_a_source() -> None:
    """No slider position reaches 0 — a source can be de-weighted, never suppressed."""
    for s in (0.0, 0.5, 1.0):
        p = Profile(weights={c: 1.0 for c in Category}, s=s)
        assert formula.rule_trust(p) > 0
        assert formula.ml_trust(p) > 0


def test_security_bypasses_the_trust_slider() -> None:
    """FR-24 mechanism 2: source_trust is pinned at 1.0 for security, at BOTH ends.

    Without this, the "trust the model" end would quietly halve every security
    finding, since all security detection is deterministic.
    """
    finding = ScoringFinding(
        "fp", Source.RULE, Category.SECURITY, Severity.CRITICAL, "a.java", 0.0
    )
    for s in (0.0, 0.5, 1.0):
        p = Profile(weights={c: 1.0 for c in Category}, s=s)
        assert formula.source_trust(finding, p) == 1.0


def test_ml_boost_cannot_invert_the_severity_ranking() -> None:
    """The bounded multipliers are a feature, not an accident.

    Max combined boost is churn 2.0 × risk 2.5 = 5×, which is less than the 8×
    spread between Low and Critical. So a maximally hot, maximally risky Low
    finding must still rank below a Critical one in a cold, safe file.
    """
    p = Profile(weights={c: 1.0 for c in Category}, s=0.0)
    hot = FileFacts("hot.java", risk_score=1.0, commits_90d=100, loc=1000)
    cold = FileFacts("cold.java", risk_score=0.0, commits_90d=0, loc=1000)

    low = ScoringFinding(
        "a", Source.RULE, Category.CODE_DESIGN, Severity.LOW, "hot.java", 1.0
    )
    critical = ScoringFinding(
        "b", Source.RULE, Category.CODE_DESIGN, Severity.CRITICAL, "cold.java", 0.0
    )

    assert formula.finding_priority(low, hot, p) < formula.finding_priority(critical, cold, p)


def test_finding_priority_uses_contextual_not_file_risk(
    balanced: Profile,
) -> None:
    facts = FileFacts("same.java", risk_score=0.9, commits_90d=0, loc=1000)
    low_risk = ScoringFinding(
        "low", Source.RULE, Category.CODE_DESIGN, Severity.MEDIUM, "same.java", 0.1
    )
    high_risk = ScoringFinding(
        "high", Source.RULE, Category.CODE_DESIGN, Severity.MEDIUM, "same.java", 0.8
    )

    assert formula.finding_priority(high_risk, facts, balanced) > formula.finding_priority(
        low_risk, facts, balanced
    )


def test_file_risk_does_not_control_finding_priority(
    balanced: Profile,
) -> None:
    finding = ScoringFinding(
        "same",
        Source.RULE,
        Category.CODE_DESIGN,
        Severity.MEDIUM,
        "same.java",
        0.5,
    )
    safe_file = FileFacts(
        "same.java", risk_score=0.0, commits_90d=0, loc=1000
    )
    risky_file = FileFacts(
        "same.java", risk_score=1.0, commits_90d=0, loc=1000
    )

    assert formula.finding_priority(
        finding, safe_file, balanced
    ) == formula.finding_priority(finding, risky_file, balanced)


def test_weights_and_s_are_clamped() -> None:
    """FR-20: clamping is a server-side rule, and it clamps rather than rejects."""
    weights, s = formula.clamp_profile({Category.SECURITY: 99.0, Category.TEST: -5.0}, s=42.0)
    assert weights[Category.SECURITY] == 3.0
    assert weights[Category.TEST] == 0.1
    assert s == 1.0


def test_grade_bands() -> None:
    assert formula.grade(85) == "A"
    assert formula.grade(70) == "B"
    assert formula.grade(55) == "C"
    assert formula.grade(40) == "D"
    assert formula.grade(39.9) == "E"


def test_repo_health_is_bounded_at_zero() -> None:
    """Debt beyond k × KLOC saturates rather than going negative."""
    assert formula.repo_health(total_debt=10**9, kloc=1.0) == 0.0
    assert formula.repo_health(total_debt=0.0, kloc=10.0) == 100.0


def _finding(
    fingerprint: str,
    source: Source,
    category: Category,
    severity: Severity,
    file: str,
    risk: float,
) -> ScoringFinding:
    return ScoringFinding(fingerprint, source, category, severity, file, risk)


def test_worked_example(balanced: Profile) -> None:
    """Hand-computed under Balanced (s = 0.5, so both trusts are 1.0) and k = 100.

        A.java: 10 commits -> churn 1.5; B.java: 0 commits -> churn 1.0; 1 KLOC each.

        f1 rule code-design high,  A, risk 0.2: 5 x 1.5 x (1 + 0.2) = 9.0
        f3 rule security  medium,  B, risk 0.5: 3 x 1.0 x (1 + 0.5) = 4.5
        f2 satd documentation low, B, risk 0.0: 1 x 1.0 x 1.0       = 1.0

        debt A = 9.0 -> health 100 x (1 - 9.0 / 100)  = 91.0
        debt B = 5.5 -> health 100 x (1 - 5.5 / 100)  = 94.5
        total 14.5 over 2 KLOC -> 100 x (1 - 14.5 / 200) = 92.75 -> grade A
    """
    from codesage_api.scoring.engine import score

    facts = {
        "A.java": FileFacts("A.java", risk_score=0.2, commits_90d=10, loc=1000),
        "B.java": FileFacts("B.java", risk_score=0.5, commits_90d=0, loc=1000),
    }
    findings = [
        _finding("f1", Source.RULE, Category.CODE_DESIGN, Severity.HIGH, "A.java", 0.2),
        _finding("f2", Source.SATD, Category.DOCUMENTATION, Severity.LOW, "B.java", 0.0),
        _finding("f3", Source.RULE, Category.SECURITY, Severity.MEDIUM, "B.java", 0.5),
    ]

    result = score(findings, facts, balanced, kloc=2.0)

    assert [item.finding.fingerprint for item in result.findings] == ["f1", "f3", "f2"]
    assert [item.priority for item in result.findings] == pytest.approx([9.0, 4.5, 1.0])
    assert {item.file: item.debt_score for item in result.files} == pytest.approx(
        {"A.java": 9.0, "B.java": 5.5}
    )
    assert {item.file: item.health_score for item in result.files} == pytest.approx(
        {"A.java": 91.0, "B.java": 94.5}
    )
    assert result.health_score == pytest.approx(92.75)
    assert result.grade == "A"
    breakdown = {item.category: (item.count, item.debt) for item in result.breakdown}
    assert breakdown[Category.CODE_DESIGN] == (1, pytest.approx(9.0))
    assert breakdown[Category.SECURITY] == (1, pytest.approx(4.5))
    assert breakdown[Category.DOCUMENTATION] == (1, pytest.approx(1.0))
    assert breakdown[Category.TEST] == (0, 0.0)


def test_critical_security_survives_minimum_weight(min_security_profile: Profile) -> None:
    """FR-24 mechanism 3 (SRS TC-24).

    Security weight at its 0.1 floor, every other weight at 3.0: the critical
    security finding must still be at index 0 — present is not sufficient.
    """
    from codesage_api.scoring.engine import score

    facts = {
        "Hot.java": FileFacts("Hot.java", risk_score=1.0, commits_90d=20, loc=500),
        "Cold.java": FileFacts("Cold.java", risk_score=0.0, commits_90d=0, loc=500),
    }
    findings = [
        _finding("design", Source.RULE, Category.CODE_DESIGN, Severity.HIGH, "Hot.java", 1.0),
        _finding("docs", Source.SATD, Category.DOCUMENTATION, Severity.MEDIUM, "Hot.java", 1.0),
        _finding("sec-high", Source.RULE, Category.SECURITY, Severity.HIGH, "Cold.java", 0.0),
        _finding("sec-critical", Source.RULE, Category.SECURITY, Severity.CRITICAL, "Cold.java", 0.0),
    ]

    result = score(findings, facts, min_security_profile, kloc=1.0)
    ranked = [item.finding.fingerprint for item in result.findings]
    by_id = {item.finding.fingerprint: item for item in result.findings}

    # Its own priority (8 x 0.1 = 0.8) is far below the heavily weighted
    # design and documentation findings on the hot file...
    assert by_id["sec-critical"].priority == pytest.approx(0.8)
    assert by_id["sec-critical"].priority < min(by_id["design"].priority, by_id["docs"].priority)
    # ...yet it is first, and flagged so the UI can explain why.
    assert ranked[0] == "sec-critical"
    assert by_id["sec-critical"].pinned_by_floor is True
    # Only critical security is pinned; everything else keeps priority order.
    assert ranked[1:] == ["design", "docs", "sec-high"]
    assert not any(item.pinned_by_floor for item in result.findings[1:])
