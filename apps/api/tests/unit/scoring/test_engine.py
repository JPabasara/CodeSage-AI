import pytest
from codesage_api.scoring.engine import score,aggregate_subtree
from codesage_api.scoring.enums import Category, Severity, Source
from codesage_api.scoring.formula import (
    finding_priority,
    grade,
    repo_health,
)
from codesage_api.scoring.models import (
    FileFacts,
    Profile,
    ScoringFinding,
)


def balanced_profile() -> Profile:
    return Profile(
        weights={
            Category.CODE_DESIGN: 1.0,
            Category.REQUIREMENT: 1.0,
            Category.DOCUMENTATION: 1.0,
            Category.TEST: 1.0,
            Category.SECURITY: 1.0,
        },
        s=0.5,
    )


def make_finding(
    *,
    fingerprint: str,
    file: str,
    category: Category,
    severity: Severity,
    source: Source = Source.RULE,
) -> ScoringFinding:
    return ScoringFinding(
        fingerprint=fingerprint,
        source=source,
        category=category,
        severity=severity,
        file=file,
    )


def test_score_calculates_priorities_and_ranks_findings() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/high.py": FileFacts(
            file="src/high.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
        "src/low.py": FileFacts(
            file="src/low.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    low = make_finding(
        fingerprint="low-finding",
        file="src/low.py",
        category=Category.CODE_DESIGN,
        severity=Severity.LOW,
    )
    critical = make_finding(
        fingerprint="critical-finding",
        file="src/high.py",
        category=Category.CODE_DESIGN,
        severity=Severity.CRITICAL,
    )

    result = score(
        findings=[low, critical],
        file_facts=file_facts,
        profile=profile,
        kloc=2.0,
    )

    assert [item.finding.fingerprint for item in result.findings] == [
        "critical-finding",
        "low-finding",
    ]

    expected_critical = finding_priority(
        critical,
        file_facts["src/high.py"],
        profile,
    )
    expected_low = finding_priority(
        low,
        file_facts["src/low.py"],
        profile,
    )

    assert result.findings[0].priority == pytest.approx(
        expected_critical
    )
    assert result.findings[1].priority == pytest.approx(
        expected_low
    )


def test_score_aggregates_file_and_repository_debt() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/app.py": FileFacts(
            file="src/app.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    finding_one = make_finding(
        fingerprint="finding-one",
        file="src/app.py",
        category=Category.CODE_DESIGN,
        severity=Severity.HIGH,
    )
    finding_two = make_finding(
        fingerprint="finding-two",
        file="src/app.py",
        category=Category.TEST,
        severity=Severity.MEDIUM,
    )

    expected_one = finding_priority(
        finding_one,
        file_facts["src/app.py"],
        profile,
    )
    expected_two = finding_priority(
        finding_two,
        file_facts["src/app.py"],
        profile,
    )
    expected_debt = expected_one + expected_two
    expected_health = repo_health(
        total_debt=expected_debt,
        kloc=1.0,
    )

    result = score(
        findings=[finding_one, finding_two],
        file_facts=file_facts,
        profile=profile,
        kloc=1.0,
    )

    assert len(result.files) == 1
    assert result.files[0].file == "src/app.py"
    assert result.files[0].debt_score == pytest.approx(
        expected_debt
    )
    assert result.files[0].health_score == pytest.approx(
        expected_health
    )

    assert result.health_score == pytest.approx(expected_health)
    assert result.grade == grade(expected_health).value


def test_file_without_findings_has_no_debt() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/clean.py": FileFacts(
            file="src/clean.py",
            risk_score=0.95,
            commits_90d=20,
            loc=500,
        ),
    }

    result = score(
        findings=[],
        file_facts=file_facts,
        profile=profile,
        kloc=0.5,
    )

    assert result.findings == ()
    assert len(result.files) == 1

    clean_file = result.files[0]

    assert clean_file.file == "src/clean.py"
    assert clean_file.risk_score == pytest.approx(0.95)
    assert clean_file.debt_score == pytest.approx(0.0)
    assert clean_file.health_score == pytest.approx(100.0)

    assert result.health_score == pytest.approx(100.0)
    assert result.grade == "A"


def test_breakdown_contains_all_categories() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/app.py": FileFacts(
            file="src/app.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    finding = make_finding(
        fingerprint="test-finding",
        file="src/app.py",
        category=Category.TEST,
        severity=Severity.HIGH,
    )

    result = score(
        findings=[finding],
        file_facts=file_facts,
        profile=profile,
        kloc=1.0,
    )

    breakdown = {
        item.category: item
        for item in result.breakdown
    }

    assert set(breakdown) == set(Category)
    assert breakdown[Category.TEST].count == 1
    assert breakdown[Category.TEST].debt > 0

    for category in Category:
        if category is not Category.TEST:
            assert breakdown[category].count == 0
            assert breakdown[category].debt == pytest.approx(0.0)


def test_score_applies_critical_security_visibility_floor() -> None:
    profile = Profile(
        weights={
            Category.CODE_DESIGN: 3.0,
            Category.REQUIREMENT: 1.0,
            Category.DOCUMENTATION: 1.0,
            Category.TEST: 1.0,
            Category.SECURITY: 0.1,
        },
        s=0.5,
    )

    file_facts = {
        "src/design.py": FileFacts(
            file="src/design.py",
            risk_score=1.0,
            commits_90d=20,
            loc=1000,
        ),
        "src/security.py": FileFacts(
            file="src/security.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    high_priority_design = make_finding(
        fingerprint="design",
        file="src/design.py",
        category=Category.CODE_DESIGN,
        severity=Severity.CRITICAL,
    )
    low_priority_security = make_finding(
        fingerprint="security",
        file="src/security.py",
        category=Category.SECURITY,
        severity=Severity.CRITICAL,
    )

    result = score(
        findings=[
            high_priority_design,
            low_priority_security,
        ],
        file_facts=file_facts,
        profile=profile,
        kloc=2.0,
    )

    assert result.findings[0].finding.fingerprint == "security"
    assert result.findings[0].pinned_by_floor is True

    assert result.findings[1].finding.fingerprint == "design"
    assert result.findings[1].pinned_by_floor is False

    # Pinning changes visibility order, not the calculated priorities.
    assert (
        result.findings[0].priority
        < result.findings[1].priority
    )


def test_equal_priorities_use_fingerprint_as_tiebreaker() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/app.py": FileFacts(
            file="src/app.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    finding_b = make_finding(
        fingerprint="b-finding",
        file="src/app.py",
        category=Category.TEST,
        severity=Severity.MEDIUM,
    )
    finding_a = make_finding(
        fingerprint="a-finding",
        file="src/app.py",
        category=Category.TEST,
        severity=Severity.MEDIUM,
    )

    result = score(
        findings=[finding_b, finding_a],
        file_facts=file_facts,
        profile=profile,
        kloc=1.0,
    )

    assert [item.finding.fingerprint for item in result.findings] == [
        "a-finding",
        "b-finding",
    ]


def test_aggregate_subtree_sums_selected_file_debt() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/api/routes.py": FileFacts(
            file="src/api/routes.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
        "src/api/auth.py": FileFacts(
            file="src/api/auth.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
        "tests/test_routes.py": FileFacts(
            file="tests/test_routes.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    findings = [
        make_finding(
            fingerprint="routes-finding",
            file="src/api/routes.py",
            category=Category.CODE_DESIGN,
            severity=Severity.HIGH,
        ),
        make_finding(
            fingerprint="auth-finding",
            file="src/api/auth.py",
            category=Category.SECURITY,
            severity=Severity.MEDIUM,
        ),
        make_finding(
            fingerprint="test-finding",
            file="tests/test_routes.py",
            category=Category.TEST,
            severity=Severity.LOW,
        ),
    ]

    result = score(
        findings=findings,
        file_facts=file_facts,
        profile=profile,
        kloc=3.0,
    )

    file_scores = {
        item.file: item.debt_score
        for item in result.files
    }

    subtree_debt = aggregate_subtree(
        files=[
            "src/api/routes.py",
            "src/api/auth.py",
        ],
        result=result,
    )

    assert subtree_debt == pytest.approx(
        file_scores["src/api/routes.py"]
        + file_scores["src/api/auth.py"]
    )


def test_aggregate_empty_subtree_returns_zero() -> None:
    result = score(
        findings=[],
        file_facts={},
        profile=balanced_profile(),
        kloc=0.0,
    )

    assert aggregate_subtree([], result) == pytest.approx(0.0)


def test_aggregate_subtree_ignores_unknown_files() -> None:
    profile = balanced_profile()

    file_facts = {
        "src/app.py": FileFacts(
            file="src/app.py",
            risk_score=0.0,
            commits_90d=0,
            loc=1000,
        ),
    }

    finding = make_finding(
        fingerprint="app-finding",
        file="src/app.py",
        category=Category.CODE_DESIGN,
        severity=Severity.HIGH,
    )

    result = score(
        findings=[finding],
        file_facts=file_facts,
        profile=profile,
        kloc=1.0,
    )

    assert aggregate_subtree(
        files=["unknown.py"],
        result=result,
    ) == pytest.approx(0.0)