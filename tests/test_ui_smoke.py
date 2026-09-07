"""Признак готовности M0: окно открывается (в offscreen-режиме)."""

from pathlib import Path

from pytestqt.qtbot import QtBot

from cam import __version__
from cam.core.config import AppDefaults
from cam.core.storage.db import Database
from cam.ui.app import build_main_window, create_application
from cam.ui.main_window import TABS, MainWindow


def test_main_window_opens_with_seven_tabs(
    qtbot: QtBot, defaults: AppDefaults, database: Database
) -> None:
    window = build_main_window(defaults, database)
    qtbot.addWidget(window)
    window.show()
    qtbot.waitExposed(window)
    assert isinstance(window, MainWindow)
    assert window.tabs.count() == len(TABS) == 7
    assert [window.tabs.tabText(i) for i in range(window.tabs.count())] == [t for t, _ in TABS]
    assert __version__ in window.windowTitle()
    assert str(Path(database.path)) in window.statusBar().currentMessage()


def test_application_font_is_enlarged_for_shop_floor(qtbot: QtBot, defaults: AppDefaults) -> None:
    app = create_application([], defaults)
    assert app.font().pointSize() == defaults.ui.font_point_size
    assert app.applicationName() == defaults.ui.window_title
