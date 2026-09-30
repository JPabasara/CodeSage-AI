"""Stable identities for profile-dependent derived score records."""

from __future__ import annotations

import hashlib
import json

from codesage_api.scoring.models import Profile

# 1.1.0: health scope is applied consistently to debt and LOC, and stored
# per-file 90-day churn participates in finding priority.
# 1.2.0: k calibrated from the 25.0 placeholder to 100.0.
SCORING_ENGINE_VERSION = "1.2.0"


def profile_fingerprint(profile: Profile) -> str:
    payload = profile_payload(profile)
    # A display-name change does not alter the scoring inputs.
    payload.pop("name", None)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def profile_payload(profile: Profile) -> dict[str, object]:
    return {
        "weights": {
            category.value: profile.weights[category]
            for category in sorted(profile.weights, key=lambda item: item.value)
        },
        "trust": profile.s,
        "name": profile.name,
        "include_test_findings": profile.include_test_findings,
    }


def profile_from_payload(payload: dict[str, object]) -> Profile:
    from codesage_api.scoring.enums import Category

    raw_weights = payload["weights"]
    if not isinstance(raw_weights, dict):
        raise TypeError("Score task received invalid profile weights.")
    return Profile(
        weights={
            Category(str(key)): float(str(value)) for key, value in raw_weights.items()
        },
        s=float(str(payload["trust"])),
        name=str(payload.get("name", "custom")),
        include_test_findings=bool(payload.get("include_test_findings", False)),
    )
