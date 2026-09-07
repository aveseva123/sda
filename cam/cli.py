"""Консольные команды без Qt: версия, обслуживание базы.

Примеры::

    cam-cli version
    cam-cli db status
    cam-cli db upgrade
    cam-cli db backup
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from cam import __version__
from cam.core.config import load_defaults
from cam.core.paths import db_path, default_data_dir
from cam.core.storage import migrate
from cam.core.storage.db import backup_database, journal_mode, make_engine, open_database


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cam-cli", description="Furniture CAM — служебные команды"
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="папка данных (по умолчанию CAM_DATA_DIR или data/ рядом с проектом)",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("version", help="показать версию")

    db = sub.add_parser("db", help="обслуживание базы данных")
    db_sub = db.add_subparsers(dest="db_command", required=True)
    db_sub.add_parser("status", help="ревизия базы, режим журнала, расхождения со схемой")
    db_sub.add_parser("upgrade", help="создать базу или обновить схему до актуальной")
    db_sub.add_parser("backup", help="снять резервную копию базы")
    return parser


def cmd_version() -> int:
    print(__version__)
    return 0


def cmd_db_status(data_dir: Path) -> int:
    path = db_path(data_dir)
    print(f"База: {path}")
    if not path.exists():
        print("Файл базы не создан. Выполните: cam-cli db upgrade")
        return 1
    engine = make_engine(path)
    try:
        current = migrate.current_revision(engine)
        head = migrate.head_revision()
        print(f"Ревизия: {current or '—'} (актуальная: {head or '—'})")
        print(f"Журнал: {journal_mode(engine)}")
        diff = migrate.pending_schema_changes(engine)
        if diff:
            print(f"Схема расходится с ORM: {len(diff)} изменений")
            for item in diff:
                print(f"  - {item}")
            return 2
        print("Схема соответствует ORM")
        return 0 if current == head else 3
    finally:
        engine.dispose()


def cmd_db_upgrade(data_dir: Path) -> int:
    defaults = load_defaults()
    database = open_database(data_dir, backups_keep=defaults.storage.backups_keep)
    try:
        print(
            f"База обновлена: {database.path} → ревизия {migrate.current_revision(database.engine)}"
        )
    finally:
        database.dispose()
    return 0


def cmd_db_backup(data_dir: Path) -> int:
    defaults = load_defaults()
    target = backup_database(db_path(data_dir), keep=defaults.storage.backups_keep)
    if target is None:
        print("Базы ещё нет — копировать нечего")
        return 1
    print(f"Резервная копия: {target}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    data_dir: Path = args.data_dir or default_data_dir()
    if args.command == "version":
        return cmd_version()
    if args.command == "db":
        if args.db_command == "status":
            return cmd_db_status(data_dir)
        if args.db_command == "upgrade":
            return cmd_db_upgrade(data_dir)
        if args.db_command == "backup":
            return cmd_db_backup(data_dir)
    raise AssertionError(f"Необработанная команда: {args}")


if __name__ == "__main__":
    sys.exit(main())
