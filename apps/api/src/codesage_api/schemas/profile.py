"""Scoring-profile wire shapes (SRS FR-20)."""

from __future__ import annotations

import uuid

from pydantic import Field

from codesage_api.schemas.base import ApiModel


class CategoryWeights(ApiModel):
    """The five category weights. One field per Category value — not a free-form
    dict — so a client that omits one or invents a sixth is rejected at the edge
    rather than producing a KeyError deep inside the scoring engine.

    Bounds are declared here for documentation and early rejection, but they are
    NOT the enforcement point: the server clamps in `services.profiles`, because
    FR-20 requires out-of-range values to be silently corrected and returned, not
    refused.
    """

    security: float
    code_design: float
    requirement: float
    documentation: float
    test: float


class ScoreProfileIn(ApiModel):
    """The body of `PUT /api/profiles/active`.

    Carries the COMPLETE profile, never a delta — which is what makes the PUT
    idempotent, and matters because the client fires a dependent read immediately
    after. A retry on a dropped response must not leave a half-applied profile.
    """

    name: str | None = Field(
        default=None,
        description="Optional label. Send a preset's name to record which preset "
        "these values came from; omit it for a custom profile.",
    )
    weights: CategoryWeights
    trust_s: float = Field(
        description="Trust slider: 0 = trust the model, 1 = trust the rules"
    )


class ScoreProfileOut(ApiModel):
    """A stored profile, returned after clamping.

    The response is the profile as it is REALLY in force, so a client that sent
    5.0 renders the 3.0 that was stored instead of believing its own value.
    """

    id: str
    name: str
    weights: CategoryWeights
    trust_s: float
    is_preset: bool
    is_active: bool
    usage_count: int = Field(
        default=0,
        description="Projects that name this profile explicitly. The workspace "
        "default is in use by every project without an override, which "
        "`is_active` already says, so it is not counted here.",
    )
    editable: bool = Field(
        default=True,
        description="False for the three built-ins, which are refused every "
        "update and delete by the database itself.",
    )


class CategoryWeightsPatch(ApiModel):
    """The same five weights, every one optional.

    PATCH carries only what changed, so an omitted weight keeps its stored value.
    A `null` is not the same as omitted and is rejected: there is no such thing as
    a profile with no security weight.
    """

    security: float | None = None
    code_design: float | None = None
    requirement: float | None = None
    documentation: float | None = None
    test: float | None = None


class CreateProfileIn(ApiModel):
    """The body of `POST /api/profiles`.

    `name` is required here and optional on the legacy apply endpoint, because a
    profile that joins a pool has to be tellable apart from the other five.
    """

    name: str = Field(min_length=1, max_length=200)
    weights: CategoryWeights
    trust_s: float = Field(
        description="Trust slider: 0 = trust the model, 1 = trust the rules"
    )


class UpdateProfileIn(ApiModel):
    """The body of `PATCH /api/profiles/{profile_id}` — a partial update.

    Every field is optional and an omitted one is left alone. An empty body is
    accepted and changes nothing, which keeps a retry harmless.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    weights: CategoryWeightsPatch | None = None
    trust_s: float | None = None


class SelectProfileIn(ApiModel):
    """The body of the two PUTs that choose a profile.

    Carries the whole selection rather than a delta, so re-sending it is
    idempotent — the second PUT of the same id changes nothing.

    Typed as a UUID so a malformed id is a 422 at the edge rather than a crash
    inside the service; an id that merely belongs to another workspace parses
    fine here and is answered with 404 further in.
    """

    profile_id: uuid.UUID


class ProjectProfileOut(ApiModel):
    """Which profile one project scores with, and where that came from.

    Both `effective` and `workspace_default` are always present so the web can
    say "inheriting Balanced" without a second request, and `override` is null
    exactly when `inherited` is true.
    """

    repo_id: str
    inherited: bool
    effective: ScoreProfileOut
    workspace_default: ScoreProfileOut
    override: ScoreProfileOut | None = None
