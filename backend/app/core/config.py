from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tally"
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://tally:tally@db:5432/tally"
    app_timezone: str = "Asia/Tokyo"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    default_user_id: str = "00000000-0000-0000-0000-000000000001"
    session_days: int = 30
    password_reset_minutes: int = 30
    cookie_name: str = "tally_session"
    cookie_secure: bool = False
    frontend_url: str = "http://localhost:3000"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_starttls: bool = True
    seed_admin_password: str = "ChangeMe123!"
    mcp_access_token: str | None = None
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)


@lru_cache
def get_settings() -> Settings:
    return Settings()
