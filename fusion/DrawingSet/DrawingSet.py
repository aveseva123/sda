"""DrawingSet — Fusion add-in: комплект чертежей мебельного изделия по 3D-модели.

Commands (панель ADD-INS в среде Design):
  * DrawingSet: Комплект чертежей   — диалог настроек и запуск конвейера
  * DrawingSet: Спецификация        — только анализ модели, CSV и отчёт (без чертежей)
  * DrawingSet: Проверка API        — что умеет эта версия Fusion
"""
import json
import traceback

import adsk.core  # type: ignore
import adsk.fusion  # type: ignore

from .lib import ui as ui_mod
from .lib.capabilities import probe
from .lib.config import load_settings, save_settings, Settings
from .lib.drawing_driver import CREATE_DRAWING_CMD
from .lib.log import Log
from .lib.pipeline import Pipeline, RESUME_EVENT_ID, RUN_EVENT_ID

_app = None
_ui = None
_handlers = []
_controls = []
_definitions = []
_custom_events = []
_pipeline = None

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
class MainCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            cmd.okButtonText = "Выпустить"
            settings = load_settings()
            ui_mod.build_inputs(cmd.commandInputs, settings)
            on_exec = MainExecuteHandler()
            cmd.execute.add(on_exec)
            _handlers.append(on_exec)
            on_change = MainInputChangedHandler()
            cmd.inputChanged.add(on_change)
            _handlers.append(on_change)
        except Exception:
            _report_error("Ошибка при создании диалога")


class MainInputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            ui_mod.handle_input_changed(adsk.core.InputChangedEventArgs.cast(args), _ui)
        except Exception:
            _report_error("Ошибка в диалоге")


class MainExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            inputs = adsk.core.CommandEventArgs.cast(args).command.commandInputs
            settings = ui_mod.read_inputs(inputs, load_settings())
            problems = settings.validate()
            if problems:
                _ui.messageBox("Настройки не приняты:\n- " + "\n- ".join(problems), "DrawingSet")
                return
            save_settings(settings)
            # Documents cannot be created inside a command transaction: run from a custom event.
            _app.fireCustomEvent(RUN_EVENT_ID, json.dumps({"mode": "full"}))
        except Exception:
            _report_error("Ошибка при запуске")


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
                _ui.messageBox("Предыдущий запуск ещё ждёт завершения диалога «Создать чертёж».", "DrawingSet")
                return
            settings = load_settings()
            log = Log("run" if mode == "full" else "spec")
            log.info(f"Запуск, режим {mode}. Настройки: {json.dumps(settings.to_dict(), ensure_ascii=False)}")
            _pipeline = Pipeline(_app, settings, log, mode=mode)
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
                    "Сборочный чертёж, взрыв-схема и деталировка по активной модели, экспорт PDF/DXF/DWG",
                    MainCreatedHandler())
        _add_button(CMD_SPEC, "DrawingSet: Спецификация",
                    "Только анализ модели по сохранённым настройкам: спецификация, фурнитура, гибы, отчёт",
                    SpecCreatedHandler())
        _add_button(CMD_PROBE, "DrawingSet: Проверка API",
                    "Показывает, какие возможности Drawing/Animation API доступны в этой версии Fusion",
                    ProbeCreatedHandler())
        for event_id, handler in ((RUN_EVENT_ID, RunEventHandler()), (RESUME_EVENT_ID, ResumeEventHandler())):
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
    try:
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
