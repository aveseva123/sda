"""Подключение к SQLite: WAL, внешние ключи, резервные копии при запуске.

Ограничение раздела 4.1.8 ТЗ: база — только на локальном диске. По сетевой шаре
WAL не работает и файл будет побит; для нескольких пользователей — PostgreSQL.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from cam.core.paths import backup_dir, db_path
from cam.core.storage import migrate

BACKUP_TIME_FORMAT = "%Y%m%d-%H%M%S-%f"


def sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def make_engine(path: Path) -> Engine:
    """Движок SQLAlchemy для файла SQLite с включёнными внешними ключами."""
    engine = create_engine(sqlite_url(path))
    event.listen(engine, "connect", _enable_foreign_keys)
    return engine


def enable_wal(engine: Engine) -> str:
    """Перевести базу в режим WAL; вернуть фактический journal_mode."""
    with engine.connect() as conn:
        mode = conn.execute(text("PRAGMA journal_mode=WAL")).scalar_one()
    return str(mode)


def journal_mode(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(conn.execute(text("PRAGMA journal_mode")).scalar_one())


def backup_database(path: Path, keep: int, now: datetime | None = None) -> Path | None:
    """Снять резервную копию через sqlite backup API и оставить ``keep`` последних.

    Возвращает путь к новой копии или ``None``, если базы ещё нет.
    Копирование через backup API безопасно при WAL — в отличие от копирования файла.
    """
    if not path.exists():
        return None
    target_dir = backup_dir(path.parent)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now()).strftime(BACKUP_TIME_FORMAT)
    target = target_dir / f"{path.stem}-{stamp}{path.suffix}"
    with sqlite3.connect(path) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    prune_backups(target_dir, path, keep)
    return target


def list_backups(target_dir: Path, path: Path) -> list[Path]:
    """Копии базы ``path`` в ``target_dir``, от старых к новым."""
    pattern = f"{path.stem}-*{path.suffix}"
    return sorted(target_dir.glob(pattern), key=lambda p: p.name)


def prune_backups(target_dir: Path, path: Path, keep: int) -> list[Path]:
    """Удалить копии сверх ``keep`` последних; вернуть удалённые."""
    backups = list_backups(target_dir, path)
    excess = backups[:-keep] if keep > 0 else backups
    for old in excess:
        old.unlink()
    return excess


@dataclass(frozen=True)
class Database:
    path: Path
    engine: Engine
    session_factory: sessionmaker[Session]

    def session(self) -> Session:
        return self.session_factory()

    def dispose(self) -> None:
        self.engine.dispose()


def open_database(
    data_dir: Path,
    *,
    backups_keep: int,
    run_migrations: bool = True,
    make_backup: bool = True,
) -> Database:
    """Открыть (или создать) базу в папке данных.

    Порядок: резервная копия существующей базы → миграции до head → WAL.
    Бэкап снимается до миграций, чтобы неудачное обновление можно было откатить.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    path = db_path(data_dir)
    if make_backup:
        backup_database(path, keep=backups_keep)
    engine = make_engine(path)
    if run_migrations:
        migrate.upgrade(engine)
    enable_wal(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return Database(path=path, engine=engine, session_factory=factory)
