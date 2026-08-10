"""Shared pytest fixtures.

Note the split, which mirrors the architecture:

    tests/unit/scoring/     no database, no broker, no HTTP — pure functions
    tests/unit/detection/   no database; rule and marker evaluation over fixtures
    tests/integration/      real PostgreSQL via testcontainers

If a test under `unit/scoring` ever needs a fixture from this file that touches a
database, something has gone wrong in the design rather than in the test.
"""

from __future__ import annotations

import pytest

from codesage_api.scoring.enums import Category
from codesage_api.scoring.models import Profile


@pytest.fixture
def balanced_profile() -> Profile:
    return Profile(weights={c: 1.0 for c in Category}, s=0.5)


@pytest.fixture
def security_first_profile() -> Profile:
    return Profile(
        weights={
            Category.SECURITY: 3.0,
            Category.CODE_DESIGN: 1.0,
            Category.REQUIREMENT: 0.8,
            Category.DOCUMENTATION: 0.5,
            Category.TEST: 1.0,
        },
        s=0.5,
    )


@pytest.fixture
def min_security_profile() -> Profile:
    """Security weight at its 0.1 floor — the adversarial case for FR-24.

    This is the profile that made mechanism 3 necessary: while profiles were
    preset-only the visibility floor held by construction, because no preset set
    security low enough to matter.
    """
    return Profile(
        weights={
            Category.SECURITY: 0.1,
            Category.CODE_DESIGN: 3.0,
            Category.REQUIREMENT: 3.0,
            Category.DOCUMENTATION: 3.0,
            Category.TEST: 3.0,
        },
        s=0.5,
    )
