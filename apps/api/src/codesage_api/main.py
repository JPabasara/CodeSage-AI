"""FastAPI application factory — the API container's entrypoint.

    uvicorn codesage_api.main:app

The worker container runs the *same image* with a different command; see
`worker.py`.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from codesage_api.config import get_settings
from codesage_api.errors import install_exception_handlers
from codesage_api.logging import configure_logging
from codesage_api.routers import api_router, system


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

    # The frontend is served from its own container and origin, so CORS is a real
    # requirement rather than a development convenience. Credentials are allowed
    # because the session travels as a cookie.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
    )

    install_exception_handlers(app)

    app.include_router(api_router)
    app.include_router(system.router)  # outside /api — operational, not product surface

    return app


app = create_app()
