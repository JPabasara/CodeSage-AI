from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from codesage_api import deps
from codesage_api.config import get_settings
from codesage_api.deps import get_current_user_id
from codesage_api.errors import PermissionDenied, install_exception_handlers
from codesage_api.logging import configure_logging, get_logger
from codesage_api.routers import api_router, public_router, system
from codesage_api.services import audit

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Code Sage AI API",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )


    @app.middleware("http")
    async def security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    install_exception_handlers(app)

    @app.exception_handler(PermissionDenied)
    def _audit_denial(request: Request, exc: PermissionDenied) -> JSONResponse:
        # A failed audit write must not turn a 403 into a 500.
        db = deps.SessionLocal()
        try:
            audit.record_denial(db, exc, method=request.method, path=request.url.path)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Could not record a denied operation")
        finally:
            db.close()
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code},
        )

    app.include_router(public_router)
    app.include_router(api_router, dependencies=[Depends(get_current_user_id)])
    app.include_router(system.ops_router)

    return app


app = create_app()
