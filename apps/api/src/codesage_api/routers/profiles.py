from __future__ import annotations

from fastapi import APIRouter, Depends

from codesage_api.schemas import ScoreProfileIn, ScoreProfileOut

router = APIRouter(tags=["profiles"])


@router.get("/profiles", response_model=list[ScoreProfileOut])
def list_profiles() -> list[ScoreProfileOut]:
    """The three presets that seed the sliders (FR-20)."""
    raise NotImplementedError


@router.get("/profiles/active", response_model=ScoreProfileOut)
def get_active_profile() -> ScoreProfileOut:
    """The workspace's active profile — five weights and the trust slider.

    Seeds the Profiles screen on load, so the sliders open at the values actually
    in force rather than at a client-side guess.
    """
    raise NotImplementedError


@router.put("/profiles/active", response_model=ScoreProfileOut)
def apply_profile(body: ScoreProfileIn) -> ScoreProfileOut:
    """Apply a profile. One idempotent write carrying the COMPLETE profile.

    What the handler does, in full:

    1. **Clamp** every weight to 0.1–3.0 and `s` to 0–1. Server-side even though
       the sliders already cannot exceed it: the sliders are a UI affordance, the
       clamp is the invariant. `repo_health` is calibrated against `k`, so one
       unclamped weight from any client would make every stored grade incomparable
       with every other. Clamp silently rather than rejecting.
    2. **Write** SCORING_PROFILE and point WORKSPACE.active_profile_id at it, in
       one transaction. Six numbers. No queue, no worker, no clone, no Snapshot.
    3. **Return the stored profile**, so the client renders what was really saved
       instead of believing its own values — a client that sent 5.0 must display
       the 3.0 that is actually in force.

    The client then re-issues its ordinary read, `GET /api/repos/{id}/health?
    branch=`, which carries no profile parameter and resolves the active profile
    itself.

    **Why PUT and not PATCH.** The body is the complete profile, not a delta, so
    applying it twice is applying it once. That matters because the client fires a
    dependent read immediately afterwards: a retry on a dropped response must not
    leave three weights updated and two not, which would render a dashboard
    matching no profile the system holds.
    """
    raise NotImplementedError
