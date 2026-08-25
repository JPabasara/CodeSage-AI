from codesage_api.scoring.enums import Category, Severity, Source
from codesage_api.scoring.floor import apply_visibility_floor
from codesage_api.scoring.models import ScoredFinding, ScoringFinding


def make_scored_finding(
    *,
    fingerprint: str,
    category: Category,
    severity: Severity,
    priority: float,
) -> ScoredFinding:
    finding = ScoringFinding(
        fingerprint=fingerprint,
        source=Source.RULE,
        category=category,
        severity=severity,
        file=f"src/{fingerprint}.py",
    )

    return ScoredFinding(
        finding=finding,
        priority=priority,
    )


def test_critical_security_finding_is_pinned_first() -> None:
    high_priority_normal = make_scored_finding(
        fingerprint="high-priority-normal",
        category=Category.CODE_DESIGN,
        severity=Severity.CRITICAL,
        priority=100.0,
    )
    low_priority_security = make_scored_finding(
        fingerprint="low-priority-security",
        category=Category.SECURITY,
        severity=Severity.CRITICAL,
        priority=1.0,
    )
    medium_priority_normal = make_scored_finding(
        fingerprint="medium-priority-normal",
        category=Category.TEST,
        severity=Severity.HIGH,
        priority=50.0,
    )

    ranked = [
        high_priority_normal,
        medium_priority_normal,
        low_priority_security,
    ]

    result = apply_visibility_floor(ranked)

    assert [item.finding.fingerprint for item in result] == [
        "low-priority-security",
        "high-priority-normal",
        "medium-priority-normal",
    ]
    assert result[0].pinned_by_floor is True
    assert result[0].priority == 1.0


def test_critical_non_security_finding_is_not_pinned() -> None:
    critical_code_design = make_scored_finding(
        fingerprint="critical-code-design",
        category=Category.CODE_DESIGN,
        severity=Severity.CRITICAL,
        priority=100.0,
    )
    high_security = make_scored_finding(
        fingerprint="high-security",
        category=Category.SECURITY,
        severity=Severity.HIGH,
        priority=50.0,
    )

    ranked = [
        critical_code_design,
        high_security,
    ]

    result = apply_visibility_floor(ranked)

    assert result == ranked
    assert all(item.pinned_by_floor is False for item in result)


def test_relative_order_is_preserved_within_both_groups() -> None:
    security_one = make_scored_finding(
        fingerprint="security-one",
        category=Category.SECURITY,
        severity=Severity.CRITICAL,
        priority=20.0,
    )
    security_two = make_scored_finding(
        fingerprint="security-two",
        category=Category.SECURITY,
        severity=Severity.CRITICAL,
        priority=10.0,
    )
    normal_one = make_scored_finding(
        fingerprint="normal-one",
        category=Category.REQUIREMENT,
        severity=Severity.HIGH,
        priority=80.0,
    )
    normal_two = make_scored_finding(
        fingerprint="normal-two",
        category=Category.DOCUMENTATION,
        severity=Severity.MEDIUM,
        priority=40.0,
    )

    ranked = [
        normal_one,
        security_one,
        normal_two,
        security_two,
    ]

    result = apply_visibility_floor(ranked)

    assert [item.finding.fingerprint for item in result] == [
        "security-one",
        "security-two",
        "normal-one",
        "normal-two",
    ]
    assert [item.pinned_by_floor for item in result] == [
        True,
        True,
        False,
        False,
    ]


def test_input_list_and_objects_are_not_modified() -> None:
    security_finding = make_scored_finding(
        fingerprint="security",
        category=Category.SECURITY,
        severity=Severity.CRITICAL,
        priority=1.0,
    )
    normal_finding = make_scored_finding(
        fingerprint="normal",
        category=Category.CODE_DESIGN,
        severity=Severity.HIGH,
        priority=10.0,
    )

    ranked = [normal_finding, security_finding]
    original_order = list(ranked)

    result = apply_visibility_floor(ranked)

    assert ranked == original_order
    assert ranked[0] is normal_finding
    assert ranked[1] is security_finding

    assert security_finding.pinned_by_floor is False
    assert result[0].pinned_by_floor is True
    assert result[0] is not security_finding