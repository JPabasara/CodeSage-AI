"""Operational endpoints. Not part of the product API surface.

Mounted outside `/api` so they are never confused with the contract in SRS
Table 3.106.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/healthz")
def liveness() -> dict[str, str]:
    """Is the process up? No dependency checks — a failing database must not cause
    an orchestrator to restart a perfectly healthy API container."""
    return {"status": "ok"}


@router.get("/readyz")
def readiness() -> dict[str, str]:
    """Can this process serve traffic? Checks PostgreSQL and Redis.

    Deliberately does NOT check the ML service: the system is designed to complete
    scans in degraded mode when inference is unavailable, so an unreachable ML
    container must not take the API out of the load-balancer rotation.
    """
    raise NotImplementedError


@router.get("/version")
def version() -> dict[str, str]:
    """Build and analysis-engine version, for correlating a result with what produced it."""
    raise NotImplementedError
