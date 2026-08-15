from fastapi import APIRouter

from codesage_api.routers import auth, branches, health, profiles, projects, scans, system

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(branches.router)
api_router.include_router(scans.router)
api_router.include_router(health.router)
api_router.include_router(profiles.router)

__all__ = ["api_router", "system"]
