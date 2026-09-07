"""Главное окно: вкладки по ходу процесса (раздел 17 ТЗ).

На этапе M0 вкладки — заглушки с указанием этапа, на котором раздел появится.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import QLabel, QMainWindow, QMessageBox, QTabWidget, QVBoxLayout, QWidget

# (заголовок вкладки, этап, на котором она наполняется)
TABS: tuple[tuple[str, str], ...] = (
    ("Проекты", "M5"),
    ("Детали", "M1"),
    ("Сменные задания", "M5"),
    ("Раскрой", "M5"),
    ("УП", "M3"),
    ("Склад", "M7"),
    ("Библиотеки", "M2"),
)


class PlaceholderTab(QWidget):
    def __init__(self, title: str, stage: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName(f"tab_{stage}_{title}")
        label = QLabel(f"Раздел «{title}» появится на этапе {stage}.", self)
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout = QVBoxLayout(self)
        layout.addWidget(label)


class MainWindow(QMainWindow):
    def __init__(
        self,
        *,
        title: str,
        version: str,
        db_file: Path,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle(f"{title} {version}")
        self.resize(1280, 800)

        self.tabs = QTabWidget(self)
        for tab_title, stage in TABS:
            self.tabs.addTab(PlaceholderTab(tab_title, stage), tab_title)
        self.setCentralWidget(self.tabs)

        self._build_menu(title, version)
        self.statusBar().showMessage(f"База данных: {db_file}")

    def _build_menu(self, title: str, version: str) -> None:
        file_menu = self.menuBar().addMenu("&Файл")
        quit_action = QAction("&Выход", self)
        quit_action.setShortcut(QKeySequence.StandardKey.Quit)
        quit_action.triggered.connect(self.close)
        file_menu.addAction(quit_action)

        help_menu = self.menuBar().addMenu("&Справка")
        about_action = QAction("&О программе", self)
        about_action.triggered.connect(
            lambda: QMessageBox.about(
                self,
                "О программе",
                f"{title} {version}\n\nCAM-система для мебельного ЧПУ-фрезера.\n"
                "Этап M0: каркас приложения.",
            )
        )
        help_menu.addAction(about_action)
