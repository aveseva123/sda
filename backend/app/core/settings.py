from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://sda:sda@localhost:5432/sda"
    redis_url: str = "redis://localhost:6379/0"
    config_dir: Path = Path(__file__).resolve().parents[3] / "config"
    storage_dir: Path = Path("/tmp/sda-storage")
    api_prefix: str = "/api"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings
