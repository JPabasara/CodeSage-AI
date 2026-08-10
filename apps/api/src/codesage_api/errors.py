"""Domain exceptions and their HTTP mapping.

Routers raise domain errors; this module decides what the wire sees. Keeping the
mapping in one place is what makes SEC-16 checkable: error messages must not leak
internal detail, and that is far easier to audit in one file than across twelve
handlers.
"""

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class CodeSageError(Exception):
    """Base for every domain error."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    message: str = "Something went wrong."


class NotFound(CodeSageError):
    status_code = status.HTTP_404_NOT_FOUND
    message = "Not found."


class NotAuthenticated(CodeSageError):
    status_code = status.HTTP_401_UNAUTHORIZED
    message = "Sign in to continue."


class RepositoryNotPublic(CodeSageError):
    """v1.0 connects public repositories only (FR-3).

    Worth its own type because the message must explain *why* rather than saying
    "forbidden" — a user pasting their own private repo has done nothing wrong and
    needs to know that private support requires a GitHub App installation, which
    is not in this release.
    """

    status_code = status.HTTP_400_BAD_REQUEST
    message = (
        "Only public repositories can be connected in this release. "
        "Private repositories require a GitHub App installation."
    )


class RepositoryUnreachable(CodeSageError):
    status_code = status.HTTP_400_BAD_REQUEST
    message = "That repository could not be reached. Check the URL and try again."


class ScanAlreadyRunning(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    message = "A scan is already running for this branch."


class MLServiceUnavailable(CodeSageError):
    """Raised by the ML clients on timeout.

    ⚠️ This is caught by the pipeline and NOT surfaced to the user as a failure.
    The scan completes in degraded mode — rule findings only, risk 0.0 — because a
    valid partial snapshot is more useful than no snapshot. It reaches HTTP only if
    something outside the pipeline calls inference, which nothing currently does.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    message = "Analysis models are temporarily unavailable."


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(CodeSageError)
    async def _handle(request: Request, exc: CodeSageError) -> JSONResponse:
        # Only the curated `message` crosses the boundary. Stack traces, SQL and
        # upstream error text stay in the logs (SEC-16).
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})
