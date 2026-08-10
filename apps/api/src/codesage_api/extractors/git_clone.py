"""Repository checkout for the worker (SRS FR-7, SEC-05).

Clones over HTTPS and checks out the exact scanned SHA. Read-only: the system
never pushes, never writes to a repository, and never modifies a repository
resource.

**Why a clone rather than the GitHub API.** The pipeline needs whole file contents
and full history; fetching those through REST would consume rate-limit quota
proportional to repository size. `git clone` consumes none at all, which is why
SAD §10 describes GitHub rate limits as "avoided rather than managed". The only
REST calls in the system are for repository and branch metadata, made by the API
process with ETag conditional requests.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path


@contextmanager
def checkout(url: str, branch: str, commit_sha: str) -> Iterator[Path]:
    """Clone `url` at `commit_sha` into a temporary directory, then always remove it.

    A context manager because the cleanup is not optional: SRS Table 10-1 budgets
    ~2 GB of local disk per concurrent scan and requires it released when the scan
    completes, fails **or is cancelled**. A worker that leaked one clone per failed
    scan would fill its disk and take out every subsequent scan on that container,
    so the `finally` is the point of this function.
    """
    raise NotImplementedError


def read_commit_date(clone_dir: Path, commit_sha: str) -> datetime:
    """The committer date of the scanned commit — the churn window's anchor (FR-11).

    Read from the clone rather than from the GitHub API so it costs no quota and
    stays available in the worker, which never calls REST.
    """
    raise NotImplementedError
