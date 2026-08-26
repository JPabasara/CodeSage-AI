from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from codesage_api.config import get_settings
from codesage_api.deps import get_current_user_id
from codesage_api.errors import install_exception_handlers
from codesage_api.logging import configure_logging
from codesage_api.routers import api_router, public_router, system


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
    # because the session travels as a cookie.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
    )

    # Every response carries these. Each line switches off one way a browser can
    # be talked into doing something on a user's behalf.
    @app.middleware("http")
    async def security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        # Always reach this host over HTTPS, even if a link says http.
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        # Treat files as the type we declare. Do not guess, and do not run them.
        response.headers["X-Content-Type-Options"] = "nosniff"
        # This is a JSON API: it loads nothing, and nobody may put it in a frame.
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )
        # Do not tell other sites which of our pages the user came from.
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    install_exception_handlers(app)

    # Deny by default. The lock sits on the router, not on the endpoints, so a
    # route added later is protected whether or not anyone remembers to do it.
    # Opening one up means moving it to `public_router`, which is a visible,
    # deliberate act rather than a forgotten decorator.
    app.include_router(public_router)
    app.include_router(api_router, dependencies=[Depends(get_current_user_id)])
    app.include_router(system.ops_router)  # /readyz, /version — not in the contract

    return app


app = create_app()
