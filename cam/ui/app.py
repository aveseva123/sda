"""Запуск приложения: настройки → база (бэкап, миграции) → главное окно."""

from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication

from cam import __version__
from cam.core.config import AppDefaults, load_defaults
from cam.core.paths import default_data_dir
from cam.core.storage.db import Database, open_database
from cam.ui.main_window import MainWindow


def create_application(argv: list[str], defaults: AppDefaults) -> QApplication:
    existing = QApplication.instance()
    app = existing if isinstance(existing, QApplication) else QApplication(argv)
    app.setApplicationName(defaults.ui.window_title)
    app.setApplicationVersion(__version__)
    font = QFont(app.font())
    font.setPointSize(defaults.ui.font_point_size)
    app.setFont(font)
    return app


def build_main_window(defaults: AppDefaults, database: Database) -> MainWindow:
    return MainWindow(
        title=defaults.ui.window_title,
        version=__version__,
        db_file=database.path,
    )


def run(argv: list[str] | None = None, data_dir: Path | None = None) -> int:
    args = list(sys.argv if argv is None else argv)
    defaults = load_defaults()
    app = create_application(args, defaults)
    database = open_database(
        data_dir or default_data_dir(), backups_keep=defaults.storage.backups_keep
    )
    try:
        window = build_main_window(defaults, database)
        window.show()
        return app.exec()
    finally:
        database.dispose()
