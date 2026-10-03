from fastapi import APIRouter

from codesage_api.routers import (
    activity,
    auth,
    branches,
    findings,
    health,
    members,
    profiles,
    projects,
    scans,
    system,
)

public_router = APIRouter(prefix="/api")
public_router.include_router(auth.public_router)
public_router.include_router(system.public_router)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(branches.router)
api_router.include_router(scans.router)
api_router.include_router(activity.router)
api_router.include_router(health.router)
api_router.include_router(findings.router)
api_router.include_router(profiles.router)
api_router.include_router(members.router)

__all__ = ["api_router", "public_router", "system"]
