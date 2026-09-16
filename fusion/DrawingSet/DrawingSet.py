"""DrawingSet — Fusion add-in: комплект чертежей мебельного изделия по 3D-модели.

Команды (панель ADD-INS, вкладка UTILITIES среды Design):
  * DrawingSet: Комплект чертежей   — палитра: настройки, построение листов, просмотр, экспорт
  * DrawingSet: Спецификация        — только анализ модели, CSV и отчёт (без чертежей)
  * DrawingSet: Проверка API        — что умеет эта версия Fusion
"""
import json
import os
import subprocess
import sys
import threading
import traceback

import adsk.core  # type: ignore
import adsk.fusion  # type: ignore

from .lib import ui as ui_mod
from .lib.capabilities import probe
from .lib.config import Settings, load_settings, save_settings
from .lib.drawing_driver import CREATE_DRAWING_CMD
from .lib.log import Log
from .lib.palette import PaletteBridge
from .lib.pipeline import Pipeline, RESUME_EVENT_ID, RUN_EVENT_ID

PALETTE_INIT_EVENT_ID = "DrawingSet_PaletteInit"

_app = None
_ui = None
_handlers = []
_controls = []
_definitions = []
_custom_events = []
_pipeline = None
_bridge = None

CMD_MAIN = "DrawingSet_Main"
CMD_SPEC = "DrawingSet_Spec"
CMD_PROBE = "DrawingSet_Probe"
PANEL_ID = "SolidScriptsAddinsPanel"


def _report_error(prefix: str) -> None:
    text = f"{prefix}\n{traceback.format_exc()}"
    try:
        _app.log(f"[DrawingSet] {text}")
    except Exception:
        pass
    if _ui:
        _ui.messageBox(text, "DrawingSet")


# ----------------------------------------------------------------------
# Palette actions (JavaScript -> Python)
# ----------------------------------------------------------------------
def _send_init() -> None:
    """Pushes the settings form into the palette (called on JS 'ready' and by the delayed timer)."""
    settings = load_settings()
    caps = probe(_app)
    _bridge.send("init", {
        "schema": ui_mod.schema(settings), "settings": settings.to_dict(), "version": caps.fusion_version,
        "caps_text": caps.report(),
        "status": "Готово. Откройте модель и нажмите «Сгенерировать».",
    })


def _on_palette_action(action: str, payload: dict):
    global _bridge
    if action == "ready":
        _send_init()
        return {"status": "OK"}
    if action in ("generate", "export"):
        settings = Settings.from_dict(payload) if payload else load_settings()
        problems = settings.validate()
        if problems:
            _bridge.send("error", {"message": "Настройки не приняты: " + "; ".join(problems)})
            return {"status": "invalid"}
        save_settings(settings)
        _app.fireCustomEvent(RUN_EVENT_ID, json.dumps({"mode": "render" if action == "generate" else "export"}))
        return {"status": "started"}
    if action == "pick_folder":
        dlg = _ui.createFolderDialog()
        dlg.title = "Папка для комплекта чертежей"
        if dlg.showDialog() == adsk.core.DialogResults.DialogOK:
            _bridge.send("folder", {"path": dlg.folder})
            return {"path": dlg.folder}
        return {"path": ""}
    if action == "open_folder":
        path = payload.get("path") or load_settings().out_dir
        os.makedirs(path, exist_ok=True)
        try:
            if sys.platform.startswith("win"):
                os.startfile(path)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as exc:
            _bridge.send("log", {"level": "warn", "message": f"Не удалось открыть папку: {exc}"})
        return {"status": "OK"}
    return {"status": "unknown action"}


class MainCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            on_exec = MainExecuteHandler()
            cmd.execute.add(on_exec)
            _handlers.append(on_exec)
        except Exception:
            _report_error("Ошибка")


class MainExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        global _bridge
        try:
            if _bridge is None:
                _bridge = PaletteBridge(_app, _on_palette_action)
            _bridge.show()
            # The JavaScript bridge appears with a delay in the Qt browser: push the settings
            # from our side as well, a little later (custom events are handled on the main thread).
            for delay in (1.5, 4.0):
                threading.Timer(delay, lambda: _app.fireCustomEvent(PALETTE_INIT_EVENT_ID, "")).start()
        except Exception:
            _report_error("Не удалось открыть палитру DrawingSet")


class PaletteInitEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            if _bridge is not None:
                _send_init()
        except Exception:
            _report_error("Ошибка инициализации палитры")


class SpecCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            on_exec = SpecExecuteHandler()
            cmd.execute.add(on_exec)
            _handlers.append(on_exec)
        except Exception:
            _report_error("Ошибка")


class SpecExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            _app.fireCustomEvent(RUN_EVENT_ID, json.dumps({"mode": "spec"}))
        except Exception:
            _report_error("Ошибка при запуске анализа")


class ProbeCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            on_exec = ProbeExecuteHandler()
            cmd.execute.add(on_exec)
            _handlers.append(on_exec)
        except Exception:
            _report_error("Ошибка")


class ProbeExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            log = Log("probe")
            caps = probe(_app)
            log.info(caps.report())
            _ui.messageBox(caps.report() + f"\n\nЛог: {log.path}", "DrawingSet: проверка API")
        except Exception:
            _report_error("Ошибка проверки API")


class RunEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        global _pipeline
        try:
            info = json.loads(adsk.core.CustomEventArgs.cast(args).additionalInfo or "{}")
            mode = info.get("mode", "full")
            if _pipeline is not None and not _pipeline.done and _pipeline.waiting_for:
                msg = "Предыдущий запуск ещё ждёт завершения диалога «Создать чертёж»."
                if _bridge is not None:
                    _bridge.send("error", {"message": msg})
                else:
                    _ui.messageBox(msg, "DrawingSet")
                return
            settings = load_settings()
            reporter = _bridge if (mode in ("render", "export") and _bridge is not None) else None
            if mode == "render" and settings.drawing_engine == "fusion":
                mode = "full"        # the palette asked for Fusion's own drawing generator
            log = Log(mode)
            if reporter is not None:
                log.listeners.append(lambda level, message: reporter.send("log", {"level": level, "message": message}))
            log.info(f"Запуск, режим {mode}. Настройки: {json.dumps(settings.to_dict(), ensure_ascii=False)}")
            previous = _pipeline if mode == "export" else None
            if mode == "export" and (previous is None or previous.document is None):
                msg = "Сначала постройте листы кнопкой «Сгенерировать»."
                if reporter is not None:
                    reporter.send("error", {"message": msg})
                else:
                    _ui.messageBox(msg, "DrawingSet")
                return
            _pipeline = Pipeline(_app, settings, log, mode=mode, reporter=reporter, previous=previous)
            _pipeline.start()
        except Exception:
            _report_error("Ошибка конвейера")


class ResumeEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            if _pipeline is None:
                return
            info = json.loads(adsk.core.CustomEventArgs.cast(args).additionalInfo or "{}")
            _pipeline.resume(cancelled=bool(info.get("cancelled")))
        except Exception:
            _report_error("Ошибка при продолжении конвейера")


class CommandTerminatedHandler(adsk.core.ApplicationCommandEventHandler):
    def notify(self, args):
        try:
            ev = adsk.core.ApplicationCommandEventArgs.cast(args)
            if ev.commandId != CREATE_DRAWING_CMD:
                return
            if _pipeline is None or _pipeline.waiting_for is None:
                return
            cancelled = False
            try:
                cancelled = bool(ev.isCanceled)
            except Exception:
                pass
            _app.fireCustomEvent(RESUME_EVENT_ID, json.dumps({"cancelled": cancelled}))
        except Exception:
            _report_error("Ошибка обработки завершения команды")


# ----------------------------------------------------------------------
def _add_button(cmd_id: str, name: str, tooltip: str, handler) -> None:
    existing = _ui.commandDefinitions.itemById(cmd_id)
    if existing:
        existing.deleteMe()
    cdef = _ui.commandDefinitions.addButtonDefinition(cmd_id, name, tooltip)
    cdef.commandCreated.add(handler)
    _handlers.append(handler)
    _definitions.append(cdef)
    panel = _ui.allToolbarPanels.itemById(PANEL_ID)
    if panel is not None:
        ctrl = panel.controls.addCommand(cdef)
        ctrl.isPromoted = True
        ctrl.isPromotedByDefault = True
        _controls.append(ctrl)
    else:
        _ui.messageBox(f"DrawingSet: панель {PANEL_ID} не найдена, команда «{name}» доступна только через "
                       "Utilities → Scripts and Add-Ins.", "DrawingSet")


def run(context):
    global _app, _ui
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        _add_button(CMD_MAIN, "DrawingSet: Комплект чертежей",
                    "Палитра: сборочный чертёж, взрыв-схема, деталировка по активной модели, экспорт PDF/DXF/SVG",
                    MainCreatedHandler())
        _add_button(CMD_SPEC, "DrawingSet: Спецификация",
                    "Только анализ модели по сохранённым настройкам: спецификация, фурнитура, гибы, отчёт",
                    SpecCreatedHandler())
        _add_button(CMD_PROBE, "DrawingSet: Проверка API",
                    "Показывает, какие возможности Drawing/Animation API доступны в этой версии Fusion",
                    ProbeCreatedHandler())
        for event_id, handler in ((RUN_EVENT_ID, RunEventHandler()), (RESUME_EVENT_ID, ResumeEventHandler()),
                                  (PALETTE_INIT_EVENT_ID, PaletteInitEventHandler())):
            try:
                _app.unregisterCustomEvent(event_id)
            except Exception:
                pass
            ev = _app.registerCustomEvent(event_id)
            ev.add(handler)
            _handlers.append(handler)
            _custom_events.append(event_id)
        on_term = CommandTerminatedHandler()
        _ui.commandTerminated.add(on_term)
        _handlers.append(on_term)
        _app.log("[DrawingSet] add-in загружен: вкладка UTILITIES, панель ADD-INS")
        if context and context.get("IsApplicationStartup") is False:
            _ui.messageBox("DrawingSet загружен. Кнопки — во вкладке UTILITIES, панель ADD-INS.", "DrawingSet")
    except Exception:
        _report_error("DrawingSet не запустился")


def stop(context):
    global _bridge
    try:
        if _bridge is not None:
            _bridge.close()
            _bridge = None
        for ctrl in _controls:
            try:
                ctrl.deleteMe()
            except Exception:
                pass
        for cdef in _definitions:
            try:
                cdef.deleteMe()
            except Exception:
                pass
        for event_id in _custom_events:
            try:
                _app.unregisterCustomEvent(event_id)
            except Exception:
                pass
        _controls.clear()
        _definitions.clear()
        _custom_events.clear()
        _handlers.clear()
    except Exception:
        _report_error("DrawingSet: ошибка при остановке")
