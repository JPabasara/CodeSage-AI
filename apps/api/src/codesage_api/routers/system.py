"""Operational endpoints.

Split in two, because they are not all the same kind of thing.

`public_router` holds the liveness probe, which IS in the API contract at
`/api/healthz` and is marked public there. It is public for a practical reason:
whatever restarts a dead container cannot be asked to sign in first.

`ops_router` holds the two that are NOT in the contract. They are mounted
outside `/api` so they are never mistaken for product surface, and so the
sign-in lock on `/api` does not apply to them — Docker has to be able to ask
"are you ready?" without a session.
"""

from __future__ import annotations

from fastapi import APIRouter

public_router = APIRouter(tags=["system"])
ops_router = APIRouter(tags=["system"])


@public_router.get("/healthz")
def liveness() -> dict[str, str]:
    """Is the process up? No dependency checks — a failing database must not cause
    an orchestrator to restart a perfectly healthy API container."""
    return {"status": "ok"}


@ops_router.get("/readyz")
def readiness() -> dict[str, str]:
    """Can this process serve traffic? Checks PostgreSQL and Redis.

    Deliberately does NOT check the ML service: the system is designed to complete
    scans in degraded mode when inference is unavailable, so an unreachable ML
    container must not take the API out of the load-balancer rotation.
    """
    raise NotImplementedError


@ops_router.get("/version")
def version() -> dict[str, str]:
    """Build and analysis-engine version, for correlating a result with what produced it."""
    raise NotImplementedError
