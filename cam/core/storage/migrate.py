"""Программный запуск миграций Alembic — без alembic.ini и без консоли.

Так база обновляется при запуске собранного ``.exe`` (раздел 18: «база
переживает обновление»), а тесты проверяют, что миграции и ORM не разошлись.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

from cam.core.storage.orm import Base

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def alembic_config(engine: Engine | None = None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", MIGRATIONS_DIR.as_posix())
    cfg.set_main_option("path_separator", "os")
    if engine is not None:
        cfg.attributes["engine"] = engine
    return cfg


def upgrade(engine: Engine, revision: str = "head") -> None:
    command.upgrade(alembic_config(engine), revision)


def downgrade(engine: Engine, revision: str) -> None:
    command.downgrade(alembic_config(engine), revision)


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def head_revision() -> str | None:
    script = ScriptDirectory.from_config(alembic_config())
    return script.get_current_head()


def pending_schema_changes(engine: Engine) -> list[Any]:
    """Расхождения между ORM-метаданными и фактической схемой базы.

    Пустой список — миграции и ``orm.py`` синхронны. Используется тестом
    и командой ``cam-cli db status``.
    """
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        return list(compare_metadata(ctx, Base.metadata))
