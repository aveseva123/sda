"""Расположение ресурсов приложения и данных пользователя.

Данные пользователя (SQLite, бэкапы, библиотеки) живут отдельно от программы
(раздел 18 ТЗ): переживают переустановку и копируются на другую машину.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ENV_DATA_DIR = "CAM_DATA_DIR"
"""Переменная окружения, переопределяющая папку данных."""

APP_DIR_NAME = "FurnitureCAM"
"""Имя папки данных в профиле пользователя (для собранного .exe)."""

DB_FILE_NAME = "cam.sqlite"
BACKUP_DIR_NAME = "backups"


def resources_dir() -> Path:
    """Папка ``cam/resources`` внутри пакета (попадает в сборку как есть)."""
    return Path(__file__).resolve().parent.parent / "resources"


def is_frozen() -> bool:
    """Запущены ли мы из сборки PyInstaller."""
    return bool(getattr(sys, "frozen", False))


def default_data_dir() -> Path:
    """Папка данных пользователя.

    Порядок: переменная ``CAM_DATA_DIR`` → для сборки ``%LOCALAPPDATA%/FurnitureCAM``
    (или ``~/.furniturecam`` вне Windows) → при запуске из исходников ``data/``
    в корне репозитория.
    """
    override = os.environ.get(ENV_DATA_DIR)
    if override:
        return Path(override).expanduser().resolve()
    if is_frozen():
        local_app_data = os.environ.get("LOCALAPPDATA") if sys.platform == "win32" else None
        if local_app_data:
            return Path(local_app_data) / APP_DIR_NAME
        return Path.home() / f".{APP_DIR_NAME.lower()}"
    return Path(__file__).resolve().parent.parent.parent / "data"


def db_path(data_dir: Path) -> Path:
    return data_dir / DB_FILE_NAME


def backup_dir(data_dir: Path) -> Path:
    return data_dir / BACKUP_DIR_NAME
