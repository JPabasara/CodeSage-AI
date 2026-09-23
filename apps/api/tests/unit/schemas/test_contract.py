"""The code must agree with docs/api/openapi.yaml.

That file is the contract the frontend generates its types from, so a
disagreement here shows up as a runtime surprise in the browser rather than as a
compile error. These tests are the cheap version of finding out.
"""

from codesage_api.main import create_app
from codesage_api.schemas import (
    BranchOut,
    CreateWorkspaceIn,
    RepoOut,
    ScoreProfileIn,
    SessionOut,
    SwitchWorkspaceIn,
    UpdateWorkspaceIn,
    WorkspaceSummaryOut,
)
from codesage_api.scoring.enums import Category, ScanPhase, Source

EXPECTED_PRODUCT_PATHS = {
    "/api/auth/login": {"get"},
    "/api/auth/callback": {"get"},
    "/api/auth/session": {"get"},
    "/api/auth/workspaces": {"get", "post"},
    "/api/auth/workspaces/{workspace_id}": {"patch"},
    "/api/auth/workspaces/active": {"put"},
    "/api/auth/logout": {"post"},
    "/api/healthz": {"get"},
    "/api/projects": {"get", "post"},
    "/api/repos/{repo_id}/branches": {"get"},
    "/api/repos/{repo_id}/health": {"get"},
    "/api/repos/{repo_id}/scans": {"get"},
    "/api/repos/{repo_id}/scan": {"post"},
    "/api/repos/{repo_id}/scan/{scan_id}": {"get"},
    "/api/repos/{repo_id}/scan/{scan_id}/stop": {"post"},
    "/api/profiles": {"get", "post"},
    "/api/profiles/active": {"get", "put"},
    "/api/profiles/default": {"get", "put"},
    "/api/profiles/{profile_id}": {"get", "patch", "delete"},
    "/api/projects/{repo_id}/profile": {"get", "put", "delete"},
}


def test_openapi_uses_the_contract_title() -> None:
    assert create_app().openapi()["info"]["title"] == "Code Sage AI API"


def test_openapi_contains_every_srs_endpoint() -> None:
    paths = create_app().openapi()["paths"]
    for path, methods in EXPECTED_PRODUCT_PATHS.items():
        assert path in paths, f"{path} is missing"
        assert methods <= set(paths[path]), f"{path} is missing {methods - set(paths[path])}"


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
    schema = ScoreProfileIn.model_json_schema()
    weights = schema["$defs"]["CategoryWeights"]
    assert set(weights["required"]) == {
        "security",
        "code_design",
        "requirement",
        "documentation",
        "test",
    }
    # `name` is optional; the profile itself is weights + the trust slider.
    assert set(schema["required"]) == {"weights", "trust_s"}
    assert "trust_s" in schema["properties"]


def test_wire_names_are_snake_case() -> None:
    """Locked decision 1. The contract, the SRS and the database all use
    snake_case, so the wire does too — one spelling, no translation layer."""
    branch = BranchOut(name="main", is_default=True, head_commit_sha="a" * 40)
    assert branch.model_dump() == {
        "name": "main",
        "is_default": True,
        "head_commit_sha": "a" * 40,
        "head_commit_at": None,
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
    payload = repo.model_dump()
    assert payload["default_branch"] == "main"
    assert payload["connected_at"] == "2026-08-12T00:00:00Z"

    session = SessionOut(
        user_id="u",
        email="a@b.c",
        name="A",
        workspace_id="w",
    )
    assert set(session.model_dump()) == {
        "user_id",
        "email",
        "name",
        "avatar_url",
        "workspace_id",
        "needs_workspace_setup",
        "role",
        "permissions",
        "identity_provider",
    }


def test_a_provider_that_shares_nothing_still_produces_a_session() -> None:
    """A GitHub account can keep its email private and never set a display name.

    That person is still signed in — identity is the Asgardeo subject, not the
    profile around it. If this shape demanded an email, the sign-in would succeed
    and then `GET /api/auth/session` would 500 on its own response model, which is
    the most confusing possible way to fail.
    """
    bare = SessionOut(user_id="u", workspace_id="w")
    assert bare.email is None
    assert bare.name is None
    assert bare.avatar_url is None

    # Only the user id is guaranteed now: a signed-in user may legitimately have
    # no workspace yet, and a required workspace_id would make that state
    # unrepresentable in the very response that has to report it.
    required = set(SessionOut.model_json_schema()["required"])
    assert required == {"user_id"}

    onboarding = SessionOut(user_id="u", needs_workspace_setup=True)
    assert onboarding.workspace_id is None
    assert onboarding.role is None
    assert onboarding.permissions == []


def test_workspace_selection_shapes_are_complete() -> None:
    request = SwitchWorkspaceIn(workspace_id="22222222-2222-2222-2222-222222222222")
    create = CreateWorkspaceIn(
        name="  Platform Team  ",
        description="  Everything platform  ",
        website_url="  https://platform.example  ",
    )
    update = UpdateWorkspaceIn(name="Core Services")
    workspace = WorkspaceSummaryOut(
        workspace_id=request.workspace_id,
        name=create.name,
        role="manager",
        is_active=True,
        description=create.description,
        website_url=create.website_url,
        project_count=3,
        member_count=7,
    )
    assert workspace.model_dump() == {
        "workspace_id": request.workspace_id,
        "name": "Platform Team",
        "role": "manager",
        "is_active": True,
        "description": "Everything platform",
        "website_url": "https://platform.example",
        "created_at": None,
        "updated_at": None,
        "project_count": 3,
        "member_count": 7,
    }
    assert update.name == "Core Services"


def test_workspace_metadata_is_validated_at_the_edge() -> None:
    import pytest

    # Blank is absent, not content: a description of three spaces is nothing.
    assert CreateWorkspaceIn(name="Team", description="   ").description is None
    assert CreateWorkspaceIn(name="Team", website_url="  ").website_url is None

    for blank in ("", "   "):
        with pytest.raises(ValueError):
            CreateWorkspaceIn(name=blank)
    with pytest.raises(ValueError):
        CreateWorkspaceIn(name="Team", website_url="not-a-url")
    with pytest.raises(ValueError):
        CreateWorkspaceIn(name="x" * 256)
    with pytest.raises(ValueError):
        UpdateWorkspaceIn(name="   ")


def test_a_partial_workspace_update_can_be_told_from_an_omitted_one() -> None:
    """Clearing a description and not mentioning it must not look the same."""
    cleared = UpdateWorkspaceIn(description=None)
    untouched = UpdateWorkspaceIn(name="Core Services")

    assert "description" in cleared.model_dump(exclude_unset=True)
    assert "description" not in untouched.model_dump(exclude_unset=True)


def test_no_shape_leaks_camel_case() -> None:
    """One sweep over the whole generated document, so a new shape added later
    cannot quietly reintroduce camelCase."""
    schemas = create_app().openapi()["components"]["schemas"]
    offenders = [
        f"{name}.{field}"
        for name, schema in schemas.items()
        for field in schema.get("properties", {})
        if any(character.isupper() for character in field)
    ]
    assert offenders == [], f"camelCase on the wire: {offenders}"


def test_dashboard_is_keyed_on_the_snapshot_not_the_attempt() -> None:
    """Locked decision 9. An attempt that was cancelled or failed has a scan id
    but produced no snapshot, so the dashboard must be keyed on the snapshot —
    the thing that is guaranteed to exist whenever there is a report to show.

    Scan history carries both, because a row there links an attempt to its result.
    """
    schemas = create_app().openapi()["components"]["schemas"]

    report = schemas["HealthReportOut"]["properties"]
    assert "snapshot_id" in report
    assert "scan_id" not in report

    summary = schemas["ScanSummaryOut"]["properties"]
    assert {"snapshot_id", "scan_id"} <= set(summary)

    status = schemas["ScanStatusOut"]["properties"]
    assert "scan_id" in status
    assert "snapshot_id" not in status


def test_every_error_code_exists_in_the_contract() -> None:
    """Clients branch on `code`, so a typo here is a bug they cannot work around."""
    from pathlib import Path

    import yaml

    from codesage_api import errors

    # tests/unit/schemas/ -> tests -> apps/api -> apps -> repository root
    repo_root = Path(__file__).resolve().parents[5]
    contract = yaml.safe_load((repo_root / "docs/api/openapi.yaml").read_text(encoding="utf-8"))
    allowed = set(contract["components"]["schemas"]["ErrorCode"]["enum"])

    used = {
        value.code
        for value in vars(errors).values()
        if isinstance(value, type) and issubclass(value, errors.CodeSageError)
    }
    assert used <= allowed, f"not in the contract's ErrorCode list: {used - allowed}"


def test_the_app_and_the_contract_agree_on_the_profile_surface() -> None:
    """A path in one and not the other is a 404 nobody sees until runtime."""
    from pathlib import Path

    import yaml

    repo_root = Path(__file__).resolve().parents[5]
    contract = yaml.safe_load((repo_root / "docs/api/openapi.yaml").read_text(encoding="utf-8"))
    served = create_app().openapi()["paths"]

    def profile_surface(paths: dict[str, dict]) -> set[tuple[str, str]]:
        return {
            (path, method)
            for path, methods in paths.items()
            if "profile" in path
            for method in methods
            if method in {"get", "post", "put", "patch", "delete"}
        }

    assert profile_surface(served) == profile_surface(contract["paths"])
