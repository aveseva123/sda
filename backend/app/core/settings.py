from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://sda:sda@localhost:5432/sda"
    redis_url: str = "redis://localhost:6379/0"
    config_dir: Path = Path(__file__).resolve().parents[3] / "config"
    # Хранилище загруженных DXF. По умолчанию рядом с кодом, а не в /tmp:
    # на Windows /tmp не существует, а на Linux он чистится при перезагрузке.
    storage_dir: Path = Path(__file__).resolve().parents[2] / "storage"
    api_prefix: str = "/api"
    # Собранный интерфейс. Если он на месте, сервер отдаёт и API, и страницы
    # с одного порта — тогда для работы в цеху хватает одного процесса и не
    # нужен ни nginx, ни Docker.
    static_dir: Path = Path(__file__).resolve().parents[3] / "frontend" / "dist"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings
