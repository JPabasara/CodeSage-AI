

from __future__ import annotations

from fastapi import APIRouter

public_router = APIRouter(tags=["system"])
ops_router = APIRouter(tags=["system"])


@public_router.get("/healthz")
def liveness() -> dict[str, str]:

    return {"status": "ok"}


@ops_router.get("/readyz")
def readiness() -> dict[str, str]:

    raise NotImplementedError


@ops_router.get("/version")
def version() -> dict[str, str]:
    raise NotImplementedError
