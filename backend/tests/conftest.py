from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Конфиги и хранилище настраиваются до импорта приложения.
os.environ.setdefault("CONFIG_DIR", str(Path(__file__).resolve().parents[2] / "config"))
_TMP_STORAGE = tempfile.mkdtemp(prefix="sda-test-storage-")
os.environ.setdefault("STORAGE_DIR", _TMP_STORAGE)
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.db import Base  # noqa: E402
from app.models import Material  # noqa: E402


@pytest.fixture
def db() -> Session:
    # StaticPool + check_same_thread: TestClient обслуживает запросы в
    # отдельном потоке, а SQLite in-memory живёт в одном соединении.
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def materials(db: Session) -> list[Material]:
    """Справочник материалов, как у мебельного цеха: три толщины."""
    items = [
        Material(
            name="ЛДСП Белый",
            thickness=18.0,
            has_grain=False,
            sheet_w=2800.0,
            sheet_h=2070.0,
            aliases=["ldsp", "белый", "white"],
        ),
        Material(
            name="ЛДСП Дуб",
            thickness=15.0,
            has_grain=True,
            sheet_w=2800.0,
            sheet_h=2070.0,
            aliases=["dub", "дуб", "oak"],
        ),
        Material(
            name="Массив",
            thickness=30.0,
            has_grain=True,
            sheet_w=3000.0,
            sheet_h=1200.0,
            aliases=["massiv", "массив"],
        ),
        Material(
            name="ХДФ",
            thickness=3.0,
            has_grain=False,
            sheet_w=2800.0,
            sheet_h=2070.0,
            aliases=["hdf", "хдф"],
        ),
    ]
    db.add_all(items)
    db.flush()
    return items


@pytest.fixture
def tmp_storage(monkeypatch, tmp_path) -> Path:
    """Изолированное хранилище для одного теста."""
    from app.core import settings as settings_module

    settings_module.get_settings.cache_clear()
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    settings_module.get_settings.cache_clear()
    yield tmp_path
    settings_module.get_settings.cache_clear()
