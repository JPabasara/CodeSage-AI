"""The dashboard read (SRS FR-12 – FR-18).

One endpoint carries the entire dashboard, and it is the endpoint the whole
architecture is arranged around.
"""

from __future__ import annotations

from fastapi import APIRouter

from codesage_api.schemas import HealthReportOut

router = APIRouter(prefix="/repos/{repo_id}", tags=["dashboard"])


@router.get("/health", response_model=HealthReportOut)
def get_health_report(repo_id: str, branch: str) -> HealthReportOut:
    """The full dashboard payload for one branch snapshot.

    Assembles, in one response: the health card (score, grade, delta, red-issue
    count), the category breakdown pie, the trend chart, the hotspot file tree, the
    per-file scores and the ranked Refactor-First list.

    **Note the signature: a branch, and nothing else.** No profile parameter, ever.
    The active profile is server-side state scoped to the workspace, so this URL is
    byte-identical before and after a profile change and the scoring formula never
    leaks into the API surface. Were the profile a query parameter, a custom slider
    setting — which has no name — would have to travel as six parameters on every
    read, and nothing would persist, so a reload, a second tab and a teammate would
    each see a different lens while the trend chart claimed to be labelled with
    "the" active profile.

    **What happens inside:** read the stored facts for the latest snapshot (one
    query), resolve the active profile, hand both to ScoringEngine, return what it
    derives. The database returns rows; scoring turns them into numbers. Nothing
    derived is written back.

    Every trend point is computed under the *currently active* profile, so
    switching profiles redraws the whole line and every point stays comparable.
    Mixing profiles along one line is prohibited — a reader could not tell a code
    change from a settings change.
    """
    raise NotImplementedError
