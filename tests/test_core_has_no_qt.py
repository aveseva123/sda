"""Правило 1 раздела 0 ТЗ: ``cam.core`` не импортирует Qt."""

import importlib
import pkgutil
import re
import subprocess
import sys
from pathlib import Path

import cam.core

CORE_DIR = Path(cam.core.__file__).parent
QT_IMPORT = re.compile(r"^\s*(from|import)\s+(PySide6|PyQt\d|shiboken\d)\b", re.MULTILINE)


def test_core_sources_do_not_import_qt() -> None:
    offenders = [
        str(path.relative_to(CORE_DIR))
        for path in CORE_DIR.rglob("*.py")
        if QT_IMPORT.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


def test_importing_all_core_modules_does_not_load_qt() -> None:
    code = "\n".join(
        [
            "import importlib, pkgutil, sys",
            "import cam.core",
            "for info in pkgutil.walk_packages(cam.core.__path__, 'cam.core.'):",
            "    if '.migrations' in info.name: continue",
            "    importlib.import_module(info.name)",
            "bad = sorted(n for n in sys.modules if n.startswith(('PySide6', 'PyQt', 'shiboken')))",
            "print(bad)",
            "sys.exit(1 if bad else 0)",
        ]
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_core_modules_are_importable() -> None:
    names = [
        info.name
        for info in pkgutil.walk_packages(cam.core.__path__, "cam.core.")
        if ".migrations" not in info.name
    ]
    assert "cam.core.models" in names
    for name in names:
        importlib.import_module(name)
