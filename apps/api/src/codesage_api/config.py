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

    database_url: str = "postgresql+psycopg://codesage_app:changeme@localhost:5432/codesage"
    migration_database_url: str = (
        "postgresql+psycopg://codesage_owner:changeme@localhost:5432/codesage"
    )
    redis_url: str = "redis://localhost:6379/0"

    ml_service_url: str = "http://localhost:8001"
    ml_timeout_seconds: float = 30.0

    asgardeo_base_url: str = ""          # https://api.asgardeo.io/t/<your-org>
    asgardeo_client_id: str = ""
    asgardeo_client_secret: str = ""
    asgardeo_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    frontend_base_url: str = "http://localhost:3000"

 
    session_cookie_name: str = "codesage_session"

    session_idle_minutes: int = 60
  
    session_absolute_hours: int = 12
    cookie_secure: bool = True

    secret_key: str = "dev-only-change-me"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    clone_dir: str = "/var/tmp/codesage-clones"


    ck_jar: str = "/opt/ck/ck.jar"
    
    analysed_extensions: list[str] = Field(default_factory=lambda: [".java"])

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. Import this, never instantiate Settings directly."""
    return Settings()
