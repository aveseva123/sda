"""Bridge between the add-in and the HTML palette (Fusion-only)."""
from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, Optional

PALETTE_ID = "DrawingSet_Palette"
PALETTE_TITLE = "DrawingSet — комплект чертежей"


def palette_html_path() -> str:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "resources", "palette", "index.html").replace("\\", "/")


class PaletteBridge:
    """Owns the palette object and routes JS actions to a callback.

    on_action(action, payload) -> optional dict returned to JavaScript as returnData.
    """

    def __init__(self, app: Any, on_action: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]]):
        import adsk.core  # type: ignore
        self.app = app
        self.ui = app.userInterface
        self.on_action = on_action
        self.palette = None
        self._handlers: list = []

        bridge = self

        class Handler(adsk.core.HTMLEventHandler):
            def notify(self, args):
                try:
                    ev = adsk.core.HTMLEventArgs.cast(args)
                    if ev.action == "response":
                        return
                    try:
                        payload = json.loads(ev.data) if ev.data else {}
                    except ValueError:
                        payload = {"raw": ev.data}
                    result = bridge.on_action(ev.action, payload or {})
                    ev.returnData = json.dumps(result if result is not None else {"status": "OK"}, ensure_ascii=False)
                except Exception as exc:  # never let an exception escape into Fusion
                    try:
                        bridge.send("error", {"message": f"Ошибка обработчика палитры: {exc}"})
                    except Exception:
                        pass

        self._handler_cls = Handler

    def show(self) -> Any:
        import adsk.core  # type: ignore
        palette = self.ui.palettes.itemById(PALETTE_ID)
        if palette is None:
            palette = self.ui.palettes.add(PALETTE_ID, PALETTE_TITLE, palette_html_path(), True, True, True, 1100, 760, True)
            try:
                palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            except Exception:
                pass
            handler = self._handler_cls()
            palette.incomingFromHTML.add(handler)
            self._handlers.append(handler)
        self.palette = palette
        palette.isVisible = True
        return palette

    def send(self, action: str, payload: Optional[Dict[str, Any]] = None) -> None:
        if self.palette is None:
            self.palette = self.ui.palettes.itemById(PALETTE_ID)
        if self.palette is None:
            return
        try:
            self.palette.sendInfoToHTML(action, json.dumps(payload or {}, ensure_ascii=False))
        except Exception:
            pass

    def close(self) -> None:
        palette = self.ui.palettes.itemById(PALETTE_ID)
        if palette is not None:
            try:
                palette.deleteMe()
            except Exception:
                pass
        self.palette = None
