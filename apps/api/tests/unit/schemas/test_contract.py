from codesage_api.main import create_app
from codesage_api.schemas import BranchOut, RepoOut, ScoreProfileIn
from codesage_api.scoring.enums import Category, ScanPhase, Source

EXPECTED_PRODUCT_PATHS = {
    "/api/auth/github": {"get"},
    "/api/auth/github/login": {"get"},
    "/api/auth/github/callback": {"get"},
    "/api/auth/session": {"post"},
    "/api/projects": {"get", "post"},
    "/api/repos/{repo_id}/branches": {"get"},
    "/api/repos/{repo_id}/health": {"get"},
    "/api/repos/{repo_id}/scans": {"get"},
    "/api/repos/{repo_id}/scan": {"post"},
    "/api/repos/{repo_id}/scan/{scan_id}": {"get"},
    "/api/repos/{repo_id}/scan/{scan_id}/stop": {"post"},
    "/api/profiles": {"get"},
    "/api/profiles/active": {"get", "put"},
}


def test_openapi_contains_every_srs_endpoint() -> None:
    paths = create_app().openapi()["paths"]
    for path, methods in EXPECTED_PRODUCT_PATHS.items():
        assert path in paths
        assert methods <= set(paths[path])


def test_canonical_srs_vocabulary() -> None:
    assert {item.value for item in Source} == {"rule", "satd"}
    assert {item.value for item in Category} == {
        "security",
        "code-design",
        "requirement",
        "documentation",
        "test",
    }
    assert "cancelled" in {item.value for item in ScanPhase}


def test_profile_request_is_complete_five_weight_shape() -> None:
    schema = ScoreProfileIn.model_json_schema(by_alias=True)
    weights = schema["$defs"]["CategoryWeights"]
    assert set(weights["required"]) == {
        "security",
        "codeDesign",
        "requirement",
        "documentation",
        "test",
    }
    assert set(schema["required"]) == {"weights", "s"}
    assert "s" in schema["properties"]


def test_secondary_web_names_are_used_on_the_wire() -> None:
    branch = BranchOut(name="main", is_default=True, last_commit_sha="a" * 40)
    assert branch.model_dump(by_alias=True) == {
        "name": "main",
        "isDefault": True,
        "lastCommitSha": "a" * 40,
        "lastCommitAt": None,
    }

    repo = RepoOut(
        id="repo-id",
        name="codesage",
        owner="team",
        visibility="public",
        url="https://github.com/team/codesage",
        default_branch="main",
        connected_at="2026-08-12T00:00:00Z",
    )
    payload = repo.model_dump(by_alias=True)
    assert payload["source"] == "public-url"
    assert payload["defaultBranch"] == "main"
    assert payload["connectedAt"] == "2026-08-12T00:00:00Z"


def test_dashboard_identifier_uses_established_scan_id_name() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    report = schemas["HealthReportOut"]
    assert "scanId" in report["properties"]
    assert "snapshotId" not in report["properties"]
