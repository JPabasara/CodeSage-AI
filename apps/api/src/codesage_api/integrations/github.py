"""GitHubGateway — all communication with GitHub passes through here (SAD §5.2).

One boundary, so replacing or adding a Git host is a single-file change.

**Two different ways of talking to GitHub, on purpose:**

    API process  → REST      repository and branch metadata, OAuth
    Worker       → git clone  the code itself

The worker never calls REST and the API never clones. That split is why rate
limits are *avoided* rather than managed: a clone consumes no REST quota at all,
so quota use is proportional to how often someone opens the projects screen, not
to how much code is analysed.

All access is read-only. The system never modifies a repository resource (SEC-05).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RepoMetadata:
    external_id: str
    owner: str
    name: str
    url: str
    is_public: bool
    default_branch: str


def fetch_repo_metadata(url: str) -> RepoMetadata:
    """Read repository metadata for the connect flow (FR-3).

    Uses ETag conditional requests, so a repeat call for unchanged metadata returns
    304 and costs no quota.
    """
    raise NotImplementedError


def fetch_branches(owner: str, name: str) -> list[dict]:
    """Branch names and head SHAs (FR-5). Also ETag-conditional."""
    raise NotImplementedError


def fetch_head_sha(owner: str, name: str, branch: str) -> str:
    """The current head SHA of one branch.

    Called on every scan request to decide skip-if-unchanged — which is why it is
    a single conditional request rather than a full branch listing.
    """
    raise NotImplementedError


def exchange_oauth_code(code: str) -> dict:
    """Exchange an authorization code for an access token (FR-1).

    The token is used to identify the user and then discarded. Nothing persists it:
    v1.0 clones public repositories anonymously, so a stored token would buy
    nothing and would be one more secret to protect.
    """
    raise NotImplementedError
