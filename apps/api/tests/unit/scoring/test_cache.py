from codesage_api.scoring.cache import profile_fingerprint
from codesage_api.scoring.enums import Category
from codesage_api.scoring.models import Profile


def _profile(*, trust: float = 0.5) -> Profile:
    return Profile(weights={category: 1.0 for category in Category}, s=trust)


def test_profile_fingerprint_is_stable() -> None:
    assert profile_fingerprint(_profile()) == profile_fingerprint(_profile())


def test_profile_fingerprint_changes_with_scoring_input() -> None:
    assert profile_fingerprint(_profile()) != profile_fingerprint(_profile(trust=0.6))
