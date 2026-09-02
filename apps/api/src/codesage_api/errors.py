

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class CodeSageError(Exception):
    

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


class RepositoryAlreadyConnected(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "ALREADY_CONNECTED"
    message = "That repository is already connected to this workspace."


class RepositoryMissingDefaultBranch(CodeSageError):
    message = "The connected repository has no default branch."


class RateLimited(CodeSageError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"
    message = "GitHub's request limit has been reached. Please try again later."


class ScanAlreadyRunning(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "SCAN_ALREADY_RUNNING"
    message = "A scan is already running for this branch."


class ScorePending(CodeSageError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "SCORE_PENDING"
    message = "The dashboard score is still being prepared. Please try again shortly."


class MLServiceUnavailable(CodeSageError):
  

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "UPSTREAM_UNAVAILABLE"
    message = "Analysis models are temporarily unavailable."


class UpstreamUnavailable(CodeSageError):
    

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "UPSTREAM_UNAVAILABLE"
    message = "A service we depend on is temporarily unavailable. Please try again."


class SignInFailed(CodeSageError):
    
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "NOT_AUTHENTICATED"
    message = "Sign-in could not be completed. Please sign in again."


class MisconfiguredSignIn(CodeSageError):
    

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
        
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content={
                "detail": "This endpoint is not implemented yet.",
                "code": "INTERNAL_ERROR",
            },
        )
