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
    """Base for every domain error.

    `code` is the part clients are allowed to branch on. It is a fixed constant
    whose meaning never changes; `message` is an English sentence someone may
    reword tomorrow. Every value below is copied from the `ErrorCode` list in
    docs/api/openapi.yaml, so the two cannot drift.
    """

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "INTERNAL_ERROR"
    message: str = "Something went wrong."


class NotFound(CodeSageError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"
    message = "Not found."


class NotAuthenticated(CodeSageError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "NOT_AUTHENTICATED"
    message = "Sign in to continue."


class RepositoryNotPublic(CodeSageError):
    """v1.0 connects public repositories only (FR-3).

    Worth its own type because the message must explain *why* rather than saying
    "forbidden" — a user pasting their own private repo has done nothing wrong and
    needs to know that private support requires a GitHub App installation, which
    is not in this release.
    """

    status_code = status.HTTP_400_BAD_REQUEST
    code = "REPOSITORY_NOT_PUBLIC"
    message = (
        "Only public repositories can be connected in this release. "
        "Private repositories require a GitHub App installation."
    )


class RepositoryUnreachable(CodeSageError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "REPOSITORY_UNREACHABLE"
    message = "That repository could not be reached. Check the URL and try again."


class ScanAlreadyRunning(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "SCAN_ALREADY_RUNNING"
    message = "A scan is already running for this branch."


class MLServiceUnavailable(CodeSageError):
    """Raised by the ML clients on timeout.

    ⚠️ This is caught by the pipeline and NOT surfaced to the user as a failure.
    The scan completes in degraded mode — rule findings only, risk 0.0 — because a
    valid partial snapshot is more useful than no snapshot. It reaches HTTP only if
    something outside the pipeline calls inference, which nothing currently does.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "UPSTREAM_UNAVAILABLE"
    message = "Analysis models are temporarily unavailable."


class UpstreamUnavailable(CodeSageError):
    """An outside service we depend on did not answer.

    Raised when Asgardeo cannot be reached during sign-in. Kept separate from
    MLServiceUnavailable because the two mean completely different things to the
    user: this one means "you cannot sign in right now", and that one means
    "your scan ran, but with rules only".
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "UPSTREAM_UNAVAILABLE"
    message = "A service we depend on is temporarily unavailable. Please try again."


class MisconfiguredSignIn(CodeSageError):
    """The service is running without the Asgardeo settings it needs.

    Deliberately its own error. The failure it replaces was a bare 404 from a
    relative redirect, which points at nothing and sends whoever is debugging it
    looking for a missing route instead of a missing environment variable.
    """

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "INTERNAL_ERROR"
    message = (
        "Sign-in is not configured on this server: CODESAGE_ASGARDEO_BASE_URL "
        "and CODESAGE_ASGARDEO_CLIENT_ID are required."
    )


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(CodeSageError)
    async def _handle(request: Request, exc: CodeSageError) -> JSONResponse:
        # Only the curated `message` crosses the boundary. Stack traces, SQL and
        # upstream error text stay in the logs (SEC-16).
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code},
        )

    @app.exception_handler(NotImplementedError)
    async def _not_built_yet(
        request: Request, exc: NotImplementedError
    ) -> JSONResponse:
        """Every endpoint that is still a stub raises this. Answer in the contract's
        envelope rather than letting it escape as an unhandled exception.

        **This is a CORS fix as much as a tidiness one.** An unhandled exception is
        caught by Starlette's ServerErrorMiddleware, which sits OUTSIDE
        CORSMiddleware in the stack. Its `text/plain` 500 therefore carries no
        `Access-Control-Allow-Origin`, so the browser blocks it and the frontend
        sees a CORS failure instead of a 500 — which sends whoever is debugging it
        to the CORS settings, which were correct all along.

        Registering a handler for a *specific* exception type puts it on
        ExceptionMiddleware, which runs INSIDE CORSMiddleware, so the response
        gets its headers. Registering one for bare `Exception` does not work: that
        goes to ServerErrorMiddleware and lands back outside. Verified, not assumed.

        Delete this once no endpoint raises NotImplementedError any more.
        """
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content={
                "detail": "This endpoint is not implemented yet.",
                "code": "INTERNAL_ERROR",
            },
        )
