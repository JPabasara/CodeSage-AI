from codesage_api.scoring.enums import Category
from codesage_api.scoring.models import Profile
from codesage_api.scoring.provenance import health_scoring_profile


def test_health_scoring_profile_freezes_actual_configuration() -> None:
    profile = Profile(
        weights={category: 1.0 for category in Category},
        s=0.5,
        name="Balanced",
        include_test_findings=False,
    )

    frozen = health_scoring_profile(
        profile,
        analysis_engine={"tool_versions": {"pmd": "7.0"}},
        model_versions={"satd": "satd-v1", "risk": "risk-v1"},
    )

    assert frozen["profile_id"] == "health-scoring-profile-v1"
    assert frozen["severity_base_points"]["critical"] == 8
    assert frozen["active_profile"]["include_test_findings"] is False
    assert frozen["health_scope"]["generated"] == "excluded from both debt and LOC"
    assert frozen["health_formula"]["current_k"] == 25.0
    assert frozen["health_formula"]["k_status"] == "placeholder_not_calibrated"
    assert frozen["analysis_engine"]["tool_versions"]["pmd"] == "7.0"
    assert frozen["model_versions"]["satd"] == "satd-v1"
