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
    assert formula.risk_factor(FileFacts("a.java", 0.0, 0, 1000), balanced) == 1.0
    trusting_model = Profile(weights=balanced.weights, s=0.0)  # ml_trust = 1.5
    assert formula.risk_factor(FileFacts("a.java", 1.0, 0, 1000), trusting_model) == 2.5


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
    finding = ScoringFinding("fp", Source.RULE, Category.SECURITY, Severity.CRITICAL, "a.java")
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

    low = ScoringFinding("a", Source.RULE, Category.CODE_DESIGN, Severity.LOW, "hot.java")
    critical = ScoringFinding("b", Source.RULE, Category.CODE_DESIGN, Severity.CRITICAL, "cold.java")

    assert formula.finding_priority(low, hot, p) < formula.finding_priority(critical, cold, p)


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


@pytest.mark.xfail(reason="engine.score not implemented yet", strict=True)
def test_worked_example() -> None:
    """TEAM TODO: transcribe a worked example and assert the exact priorities.

    This is the fixture the whole "scoring is a pure function" argument is for —
    hand-computed numbers, no database, exact equality. Write it once `k` has been
    calibrated, since repo_health depends on it.
    """
    raise NotImplementedError


@pytest.mark.xfail(reason="floor.apply_visibility_floor not implemented yet", strict=True)
def test_critical_security_survives_minimum_weight() -> None:
    """FR-24 mechanism 3 (SRS TC-24).

    Security weight at its 0.1 floor, delivery-speed everywhere else: the critical
    security finding must still be at index 0 — present is not sufficient.
    """
    raise NotImplementedError
