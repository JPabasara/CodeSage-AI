"""Application settings — the single place environment variables are read.

Nothing else in the codebase touches ``os.environ``. See ``.env.example`` for the
full list with explanations.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CODESAGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Data layer ──────────────────────────────────────────────────────────
    # Must be a NON-superuser role, or Row-Level Security silently does nothing
    # (SRS DB-2). See infra/postgres/init/01-init.sql.
    database_url: str = "postgresql+psycopg://codesage_app:changeme@localhost:5432/codesage"
    migration_database_url: str = (
        "postgresql+psycopg://codesage_owner:changeme@localhost:5432/codesage"
    )

    # ── Broker: API enqueues, workers consume (SAD §6) ──────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── ML inference (SAD §7) — called by workers only, never by the API ────
    ml_service_url: str = "http://localhost:8001"
    # Exceeding this budget is not a scan failure: the pipeline completes with
    # rule-engine findings only (UC-3 extension 6a, SAD §11 reliability).
    ml_timeout_seconds: float = 30.0

    # ── GitHub: v1.0 is OAuth sign-in + public repo metadata only (SAD §1.2) ─
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_callback_url: str = "http://localhost:8000/api/auth/github/callback"

    secret_key: str = "dev-only-change-me"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # ── Worker scratch: ~2 GB per concurrent scan, released on completion ────
    clone_dir: str = "/var/tmp/codesage-clones"

    # ── Extraction toolchain (SRS FR-7) ─────────────────────────────────────
    # CK is a Java jar run as a subprocess, so this is a filesystem path, not a
    # package name. The image installs it; see the Dockerfile.
    ck_jar: str = "/opt/ck/ck.jar"
    # v1.0 analyses Java only, because CK is a Java-only extractor (SRS §2.4).
    # Widening this list needs a Tree-sitter grammar, a per-language rule pack and
    # a recalibration of k — it is not just a config change.
    analysed_extensions: list[str] = Field(default_factory=lambda: [".java"])

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. Import this, never instantiate Settings directly."""
    return Settings()
