"""Security patterns — the two v1.0 rules (SRS Appendix C.1).

These run INSIDE the rule engine, not as a separate detector. One engine, one
pass. The consequence is worth stating plainly because it explains a schema
decision: a security finding is `source = rule` with `category = security`, and
there is no `source = security` value anywhere in the system.

Both rules feed the FR-24 visibility floor. `hardcoded-secret` is permanently
Critical in the register, which is mechanism 1 of that floor — a constant nobody
can drag, precisely because you never want "the model *thinks* there might be a
secret" deciding what a security lead sees first.
"""

from __future__ import annotations

from pathlib import Path


def detect_hardcoded_secret(file_path: Path, source: str) -> list[dict]:
    """Regex over credential-shaped assignments, confirmed by a Shannon-entropy test.

    Two-stage on purpose. The regex alone (an identifier containing key/token/
    secret/password receiving a string literal) fires constantly on test fixtures
    and placeholder config. The entropy test alone flags every base64 blob and
    checksum. Together they are specific enough for a Critical severity to be
    honest — and Critical it must be, because that severity is what floats the
    finding to the top of a delivery-speed profile.
    """
    raise NotImplementedError


def detect_sql_concat(file_path: Path, source: str) -> list[dict]:
    """SQL built by string concatenation rather than a parameterised query.

    Matches string literals containing SQL keywords that are joined with `+` or a
    StringBuilder append to a non-literal — the Java shapes of the injection
    pattern.
    """
    raise NotImplementedError
