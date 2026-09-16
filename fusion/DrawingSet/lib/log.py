"""Logging to a file in the user's DrawingSet folder and to the Fusion text console."""
from __future__ import annotations

import datetime as _dt
import os
import traceback
from typing import List, Optional

from .config import user_data_dir


class Log:
    def __init__(self, name: str = "drawingset"):
        self.dir = os.path.join(user_data_dir(), "logs")
        os.makedirs(self.dir, exist_ok=True)
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = os.path.join(self.dir, f"{name}-{stamp}.log")
        self.lines: List[str] = []
        self.warnings: List[str] = []
        self.listeners: List = []      # callables (level, message) e.g. the palette
        self._app = None
        try:
            import adsk.core  # type: ignore
            self._app = adsk.core.Application.get()
        except Exception:  # pragma: no cover - outside Fusion
            self._app = None

    def _write(self, level: str, message: str) -> None:
        stamp = _dt.datetime.now().strftime("%H:%M:%S")
        line = f"{stamp} {level:<5} {message}"
        self.lines.append(line)
        try:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass
        if self._app is not None:
            try:
                self._app.log(f"[DrawingSet] {message}")
            except Exception:
                pass
        for fn in list(self.listeners):
            try:
                fn(level.lower(), message)
            except Exception:
                pass

    def info(self, message: str) -> None:
        self._write("INFO", message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self._write("WARN", message)

    def error(self, message: str, exc: Optional[BaseException] = None) -> None:
        self._write("ERROR", message)
        if exc is not None:
            self._write("ERROR", "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))

    def text(self) -> str:
        return "\n".join(self.lines)
