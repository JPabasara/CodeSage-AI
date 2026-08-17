"""Scoring-profile wire shapes (SRS FR-20)."""

from __future__ import annotations

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
