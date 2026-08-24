from fastapi import APIRouter

from codesage_api.routers import auth, branches, health, profiles, projects, scans, system

# No sign-in required. The two endpoints whose job is to create a session, the
# one whose job is to destroy it, and the liveness probe. Sign-out belongs here
# because it must be idempotent: signing out twice, or after the idle timeout,
# still has to clear the cookie, and demanding a live session before allowing you
# to end one leaves the user holding a dead cookie with no way to drop it.
# These four, and nothing else, are marked `security: []` in
# docs/api/openapi.yaml — so the contract and the code agree.
public_router = APIRouter(prefix="/api")
public_router.include_router(auth.public_router)
public_router.include_router(system.public_router)

# Everything else. A route added to any of these is protected automatically,
# because the lock is applied to this router as a whole in main.py rather than
# to each endpoint — nobody has to remember it.
api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(branches.router)
api_router.include_router(scans.router)
api_router.include_router(health.router)
api_router.include_router(profiles.router)

__all__ = ["api_router", "public_router", "system"]
