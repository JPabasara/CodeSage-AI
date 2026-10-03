from __future__ import annotations

import uuid

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class CodeSageError(Exception):
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "INTERNAL_ERROR"
    message: str = "Something went wrong."

    def body(self) -> dict[str, object]:
        """The error envelope. Subclasses add contract-listed fields only."""
        return {"detail": self.message, "code": self.code}


class NotFound(CodeSageError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"
    message = "Not found."


class NotAuthenticated(CodeSageError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "NOT_AUTHENTICATED"
    message = "Sign in to continue."


class Forbidden(CodeSageError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"
    message = "You do not have permission to perform this operation."


class PermissionDenied(Forbidden):
    """A 403 that knows who was refused what, so the refusal can be audited.

    The response body is identical to `Forbidden`: the caller learns nothing
    extra. The identifiers exist only for the security audit record.
    """

    def __init__(
        self,
        *,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        permission: str,
    ) -> None:
        super().__init__(permission)
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.permission = permission


class Conflict(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"
    message = "The requested change conflicts with the current workspace state."


class ValidationFailed(CodeSageError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "VALIDATION_FAILED"
    message = "The request is not valid."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message)
        if message is not None:
            self.message = message


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


class RepositoryTooLarge(CodeSageError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "REPOSITORY_TOO_LARGE"

    def __init__(self, limit_mb: int) -> None:
        self.message = (
            f"This repository is larger than {limit_mb} MB, "
            "the most CodeSage can analyse today."
        )
        super().__init__(self.message)


class RepositoryHasNoJava(CodeSageError):
    """GitHub found no Java. The body lists what it did find, so the sentence
    reads as accurate rather than as a guess."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "REPOSITORY_HAS_NO_JAVA"
    message = (
        "We couldn't find any Java in this repository. "
        "CodeSage reads Java for now; more languages are coming soon."
    )

    def __init__(self, languages: list[str]) -> None:
        self.languages = languages
        super().__init__(self.message)

    def body(self) -> dict[str, object]:
        return {**super().body(), "languages": self.languages}


class RepositoryMissingDefaultBranch(CodeSageError):
    message = "The connected repository has no default branch."


class RepositoryScanRunning(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "REPOSITORY_SCAN_RUNNING"
    message = "Stop or wait for the queued or running scan before removing this repository."


class WorkspaceRequired(CodeSageError):
    """The caller is signed in, but has not finished onboarding.

    Deliberately NOT 401. The session is valid and the identity is known; what is
    missing is a workspace to act in. Answering 401 would send the web back to
    sign-in, which would succeed and land in exactly the same state — a loop the
    user cannot escape.
    """

    status_code = status.HTTP_409_CONFLICT
    code = "WORKSPACE_REQUIRED"
    message = "Create a workspace before using this part of the application."


class WorkspaceScanRunning(Conflict):
    code = "WORKSPACE_SCAN_RUNNING"
    message = "Stop or wait for active scans before deleting this workspace."


class WorkspaceConfirmationMismatch(Conflict):
    code = "WORKSPACE_CONFIRMATION_MISMATCH"
    message = "Type the workspace name exactly to confirm deletion."


class LastWorkspaceAdmin(Conflict):
    code = "LAST_WORKSPACE_ADMIN"
    message = "Transfer administration before deleting the last administrator account."


class ProfileLimitReached(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "PROFILE_LIMIT_REACHED"
    message = "A workspace can hold at most five custom scoring profiles."


class ProfileBuiltIn(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "PROFILE_BUILT_IN"
    message = "Built-in profiles cannot be edited or deleted. Clone one instead."


class ProfileInUse(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "PROFILE_IN_USE"
    message = (
        "This profile is the workspace default or is assigned to a project. "
        "Change those selections before deleting it."
    )


class ProfileNameConflict(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "PROFILE_NAME_CONFLICT"
    message = "Another profile in this workspace already uses that name."




class RateLimited(CodeSageError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"
    message = "GitHub's request limit has been reached. Please try again later."


class ScanAlreadyRunning(CodeSageError):
    status_code = status.HTTP_409_CONFLICT
    code = "SCAN_ALREADY_RUNNING"
    message = "A scan is already running for this branch."


class ScanQueueFull(CodeSageError):
    """The workspace already has as many scans waiting as it may."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "SCAN_QUEUE_FULL"

    def __init__(self, limit: int) -> None:
        waiting = "1 scan is" if limit == 1 else f"{limit} scans are"
        self.message = (
            f"{waiting} already waiting in this workspace. "
            "Try again when one finishes."
        )
        super().__init__(self.message)


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
        return JSONResponse(status_code=exc.status_code, content=exc.body())

    @app.exception_handler(NotImplementedError)
    async def _not_built_yet(request: Request, exc: NotImplementedError) -> JSONResponse:

        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content={
                "detail": "This endpoint is not implemented yet.",
                "code": "INTERNAL_ERROR",
            },
        )
