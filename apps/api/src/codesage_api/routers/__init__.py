"""HTTP edge. Routers translate requests into service calls and back — nothing more.

The thirteen v1.0 endpoints (SRS Table 3.106):

    GET  /api/auth/github                      begin sign-in            FR-1
    GET  /api/auth/github/login                OAuth redirect target    FR-1
    GET  /api/auth/github/callback             the signed-in user       FR-1
    POST /api/auth/session                     end the session          FR-1, SEC-10
    GET  /api/projects                         list projects            FR-4
    POST /api/projects                         connect by URL           FR-3
    GET  /api/repos/{repoId}/branches          branches + head SHAs     FR-5
    GET  /api/repos/{repoId}/health?branch=    the dashboard payload    FR-12–FR-18
    GET  /api/repos/{repoId}/scans             scan history             FR-19
    POST /api/repos/{repoId}/scan              start a scan             FR-6
    GET  /api/repos/{repoId}/scan/{scanId}     poll phase + progress    FR-6
    POST /api/repos/{repoId}/scan/{scanId}/stop  cancel                 FR-6
    GET  /api/profiles                         list presets             FR-20
    GET  /api/profiles/active                  the active profile       FR-20
    PUT  /api/profiles/active                  apply a profile          FR-20

No router contains domain logic. The rule is enforced by the `layers point
downward only` import contract: routers may import services, services may import
db, and nothing points back up.
"""

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
