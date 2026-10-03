"""Application settings — the single place environment variables are read.

Nothing else in the codebase touches ``os.environ``. See ``.env.example`` for the
full list with explanations.
"""

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CODESAGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://codesage_app:changeme@localhost:5432/codesage"
    migration_database_url: str = (
        "postgresql+psycopg://codesage_owner:changeme@localhost:5432/codesage"
    )

    # Broker configuration.
    redis_url: str = "redis://localhost:6379/0"

    # Optional for public repositories, but raises the GitHub REST rate limit.
    github_token: str = ""

    # ML inference configuration.
    ml_service_url: str = "http://localhost:8001"
    ml_timeout_seconds: float = 30.0

    asgardeo_base_url: str = ""          # https://api.asgardeo.io/t/<your-org>
    asgardeo_client_id: str = ""
    asgardeo_client_secret: str = ""
    asgardeo_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    frontend_base_url: str = "http://localhost:3000"

    resend_api_key: str = ""
    invitation_from_email: str = "CodeSage <onboarding@resend.dev>"
    email_timeout_seconds: float = 10.0

    # ── The session cookie ───────────────────────────────────────────────────
    session_cookie_name: str = "codesage_session"
    # Signed out after an hour of doing nothing...
    session_idle_minutes: int = 60
    # ...and after twelve hours no matter how busy you have been.
    session_absolute_hours: int = 12
    # Cookie is sent over HTTPS only. Set to false for plain http on localhost.
    cookie_secure: bool = True
    cookie_domain: str = ""

    secret_key: str = "dev-only-change-me"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # ── Worker scratch: ~2 GB per concurrent scan, released on completion ────
    clone_dir: str = "/var/tmp/codesage-clones"

    ck_jar: str = "/opt/ck/ck.jar"
    # Import-path boundary for a replaceable optional detector.
    detector_provider: str = "codesage_api.detection.pmd:scan"
    # PMD is optional: unavailable tooling degrades only this detector stage.
    pmd_enabled: bool = False
    pmd_bin: str = "/opt/pmd/bin/pmd"
    pmd_timeout_seconds: float = 120.0
    analysed_extensions: list[str] = Field(default_factory=lambda: [".java"])

    max_repository_size_mb: int = Field(default=500, ge=1)
    max_satd_comments: int = Field(default=5_000, ge=1)
    scan_time_limit_seconds: int = Field(default=31 * 60, ge=120)
    scan_soft_time_limit_seconds: int = Field(default=30 * 60, ge=60)
    # Any single git command (clone, checkout, rev-parse, show).
    git_timeout_seconds: int = Field(default=5 * 60, ge=10)
    # Scans beyond this per workspace wait in the queue for a free slot.
    max_running_scans_per_workspace: int = Field(default=1, ge=1)
    max_queued_scans_per_workspace: int = Field(default=5, ge=1)
    # How often a waiting scan checks for a free slot.
    scan_queue_retry_seconds: int = Field(default=15, ge=1)

    log_level: str = "INFO"

    @model_validator(mode="after")
    def _soft_limit_first(self) -> "Settings":
        if self.scan_soft_time_limit_seconds >= self.scan_time_limit_seconds:
            raise ValueError(
                "CODESAGE_SCAN_SOFT_TIME_LIMIT_SECONDS must be below "
                "CODESAGE_SCAN_TIME_LIMIT_SECONDS."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. Import this, never instantiate Settings directly."""
    return Settings()
