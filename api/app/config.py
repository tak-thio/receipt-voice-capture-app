from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Owner/superuser URL — used by Alembic migrations (DDL, role creation).
    database_url: str = "postgresql+asyncpg://receipt:receipt@localhost:5433/receipt"
    # Restricted, RLS-bound role — used by the running app. Superusers bypass RLS,
    # so the runtime MUST NOT connect as the owner. Falls back to database_url if unset.
    app_database_url: str = ""

    session_secret: str = "dev-session-secret"
    # Fernet key (urlsafe base64, 32 bytes) for encrypting per-firm AI keys.
    encryption_key: str = ""

    # Object storage (S3/MinIO).
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "receipts"
    s3_region: str = "us-east-1"

    # Self-hosted AI hosts (VM host).
    ollama_host: str = "http://host.docker.internal:11434"
    ollama_text_model: str = "qwen2.5:14b"
    ollama_vision_model: str = "qwen2.5vl:7b"
    whisper_host: str = "http://host.docker.internal:9100"

    cors_origins: str = "http://localhost:5173"
    cookie_secure: bool = False

    @property
    def runtime_database_url(self) -> str:
        return self.app_database_url or self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
