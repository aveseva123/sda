"""Orchestration of the whole run as a resumable sequence of steps.

The pipeline is started from a custom event (outside of any command transaction, which is
required for creating/opening documents). When the interactive "Create Drawing" route is
used, a step returns WAIT and the pipeline is resumed from the commandTerminated handler.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import traceback
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import ai, bom, docbuild, drawing_driver as dd, explode_fusion, export, model, spec as spec_mod
from .capabilities import Capabilities, probe
from .config import Settings
from .naming import build_file_name, sanitize_filename
from .textutil import table_text

WAIT = "WAIT"
RUN_EVENT_ID = "DrawingSet_Run"
RESUME_EVENT_ID = "DrawingSet_Resume"


class Pipeline:
    def __init__(self, app: Any, settings: Settings, log: Any, mode: str = "full", reporter: Any = None,
                 previous: Optional["Pipeline"] = None):
        self.app = app
        self.ui = app.userInterface
        self.settings = settings
        self.log = log
        self.mode = mode                      # full | spec | render | export
        self.reporter = reporter              # object with send(action, payload) (the palette) or None
        self.scene = None
        self.document = None
        self.caps: Capabilities = probe(app)
        self.steps: List[Tuple[str, Callable[[], Any]]] = []
        self.index = 0
        self.waiting_for: Optional[str] = None
        self.doc: Any = None
        self.design: Any = None
        self.data: Optional[model.ModelData] = None
        self.rows: List[bom.SpecRow] = []
        self.outputs: List[str] = []
        self.manual_steps: List[str] = []
        self.generated_drawings: List[Any] = []
        self.copy_doc: Any = None
        self.copy_df: Any = None
        self.explode_result = None
        self.progress = None
        self.done = False
        self.ai_history: Dict[str, List[Dict[str, str]]] = {}
        self._pending_kind: Optional[str] = None
        self._pending_use_storyboard = False
        if previous is not None:              # export mode reuses the last rendered document (set last: nothing may overwrite it)
            self.scene, self.document, self.data, self.rows = previous.scene, previous.document, previous.data, previous.rows
            self.explode_result = previous.explode_result
            self.ai_history = getattr(previous, "ai_history", {})
        self._build_steps()

    # ------------------------------------------------------------------
    def _build_steps(self) -> None:
        s = self.settings
        if self.mode == "export":
            self.steps.append(("Экспорт", self.step_export_render))
            self.steps.append(("Завершение", self.step_finish))
            return
        self.steps.append(("Подготовка модели", self.step_prepare))
        if self.mode == "spec":
            self.steps.append(("Отчёт", self.step_finish))
            return
        if self.mode == "render" or (self.mode == "full" and s.drawing_engine == "own"):
            self.mode = "render"
            self.steps.append(("Чтение геометрии", self.step_extract))
            self.steps.append(("Построение листов", self.step_render))
            self.steps.append(("Завершение", self.step_finish))
            return
        if s.make_assembly:
            self.steps.append(("Сборочный чертёж", self.step_assembly))
        if s.make_explode:
            self.steps.append(("Взрыв-схема", self.step_explode))
        if s.make_details:
            self.steps.append(("Деталировка", self.step_details))
        if s.export_summary_pdf:
            self.steps.append(("Сводный PDF", self.step_summary))
        self.steps.append(("Завершение", self.step_finish))

    def start(self) -> None:
        if self.reporter is None:
            try:
                self.progress = self.ui.createProgressDialog()
                self.progress.isCancelButtonShown = False
                self.progress.show("DrawingSet", "Подготовка…", 0, max(len(self.steps), 1), 0)
            except Exception:
                self.progress = None
        self.run()

    def report(self, message: str, value: Optional[float] = None) -> None:
        if self.reporter is not None:
            payload = {"message": message}
            if value is not None:
                payload["value"] = value
            self.reporter.send("progress", payload)

    def resume(self, cancelled: bool = False) -> None:
        if self.waiting_for is None:
            return
        kind = self.waiting_for
        self.waiting_for = None
        if cancelled:
            self.log.warn(f"[{kind}] диалог «Создать чертёж» отменён — лист пропущен.")
            self.manual_steps.append(f"{kind}: чертёж не создан (диалог отменён).")
            self.index += 1
        else:
            try:
                self._after_ui_drawing(kind)
            except Exception as exc:
                self._fail(exc)
                return
            self.index += 1
        self.run()

    def run(self) -> None:
        import adsk.core  # type: ignore
        while self.index < len(self.steps) and not self.done:
            name, fn = self.steps[self.index]
            self._progress(name)
            self.log.info(f"=== {name} ===")
            if self.reporter is not None:
                self.reporter.send("log", {"level": "info", "message": f"— {name}"})
            try:
                outcome = fn()
            except Exception as exc:
                self._fail(exc)
                return
            if outcome == WAIT:
                return
            self.index += 1
            try:
                adsk.doEvents()
            except Exception:
                pass
        self._hide_progress()

    def _progress(self, message: str) -> None:
        self.report(message, self.index / max(len(self.steps), 1))
        if self.progress is not None:
            try:
                self.progress.progressValue = self.index
                self.progress.message = message
            except Exception:
                pass

    def _hide_progress(self) -> None:
        if self.progress is not None:
            try:
                self.progress.hide()
            except Exception:
                pass
            self.progress = None

    def _fail(self, exc: BaseException) -> None:
        self.done = True
        self._hide_progress()
        self.log.error("Конвейер остановлен", exc)
        try:
            self.write_report(failed=True)
        except Exception:
            pass
        if self.reporter is not None:
            self.reporter.send("error", {"message": f"{exc} (лог: {self.log.path})"})
        else:
            self.ui.messageBox(f"DrawingSet: ошибка.\n{exc}\n\nЛог: {self.log.path}", "DrawingSet")

    # ------------------------------------------------------------------
    def step_prepare(self) -> None:
        import adsk.fusion  # type: ignore
        s = self.settings
        self.log.info("Возможности API:\n" + self.caps.report())
        doc = self.app.activeDocument
        design = adsk.fusion.Design.cast(self.app.activeProduct)
        if design is None:
            raise RuntimeError("Активный документ не является дизайном Fusion.")
        self.doc, self.design = doc, design
        if self.mode == "full" and self.settings.drawing_engine == "fusion":
            if not doc.isSaved:
                raise RuntimeError("Документ ни разу не сохранён: сохраните его в проект, генератор чертежей Fusion работает с сохранённым файлом.")
        self.data = model.collect(design.rootComponent, s, self.log, product_name=doc.name)
        data = self.data
        if not data.parts:
            raise RuntimeError("В модели не найдено ни одного видимого компонента с телами.")
        self.log.info(f"Найдено деталей: {len([p for p in data.parts if p.category != 'assembly'])}, "
                      f"подсборок: {len([p for p in data.parts if p.category == 'assembly'])}, "
                      f"крепежа: {len([p for p in data.parts if p.is_hardware])}, "
                      f"листового металла: {len(data.sheet_metal)}")
        if s.write_component_props:
            n = model.write_component_properties(data, self.log)
            self.log.info(f"Обновлено полей partNumber/description: {n}")
        if data.sheet_metal and (s.sheet_metal_flat or s.sheet_metal_bend_table):
            model.prepare_sheet_metal(data, s, self.log)
        self.rows = bom.group_parts(data.parts)
        self.log.info("Спецификация:\n" + table_text(bom.SPEC_HEADER, bom.spec_rows(self.rows)))
        hw = bom.hardware_rows(self.rows)
        if hw:
            self.log.info("Фурнитура:\n" + table_text(bom.HARDWARE_HEADER, hw))
        if data.section_markers:
            self.log.info("Маркеры разрезов: " + "; ".join(data.section_markers))
        if s.asm_sections:
            if data.section_markers:
                self.manual_steps.append(
                    "Разрезы/выносные виды: API не создаёт виды, добавьте вручную в СБ по маркерам: "
                    + "; ".join(data.section_markers))
            else:
                self.manual_steps.append(
                    f"Разрезы включены, но маркеров с префиксом «{s.section_marker_prefix}» в модели нет.")
        if s.export_csv and self.mode in ("spec", "full"):
            self.outputs += export.write_tables(s.out_dir, self.base_name(), self.rows, data.bends, self.log)
        # explode preview (dry run) is always computed: it goes to the report
        self.explode_result = explode_fusion.compute(data, s)
        if self.mode == "full" and s.drawing_engine == "fusion":
            if s.save_before_run and doc.isModified:
                self.log.info("Сохранение документа перед генерацией…")
                if not doc.save("DrawingSet: подготовка к выпуску чертежей"):
                    raise RuntimeError("Не удалось сохранить документ.")
                self._wait_complete(doc)

    def _wait_complete(self, doc: Any, timeout: float = 120.0) -> None:
        import time
        import adsk.core  # type: ignore
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if doc.dataFile.isComplete:
                    return
            except Exception:
                return
            adsk.doEvents()
            time.sleep(0.25)

    # ------------------------------------------------------------------
    def base_name(self, kind: str = "") -> str:
        d = self.data
        return build_file_name(self.settings.file_mask, project=d.project if d else "",
                               view=d.view if d else "", product=d.product if d else "", kind=kind)

    def _request(self, kind: str, data_file: Any, **kw) -> dd.DrawingRequest:
        s = self.settings
        return dd.DrawingRequest(
            kind=kind, data_file=data_file, has_subassemblies=self.data.has_subassemblies,
            hardware_keywords=s.hardware_keywords, hide_hardware=(s.hardware_mode == "hide"), **kw)

    def _make_drawing(self, req: dd.DrawingRequest) -> Any:
        """Returns the drawing document, or WAIT when the UI route was started."""
        route = "ui" if self.settings.force_ui_fallback else self.caps.drawing_route
        if route == "api":
            try:
                return dd.create_drawing_via_api(self.app, req, self.settings, self.log)
            except Exception as exc:
                self.log.warn(f"[{req.kind}] автосоздание через API не удалось ({exc}); переход к диалогу «Создать чертёж».")
                route = "ui" if self.caps.create_drawing_command else "none"
        if route == "ui":
            self._pending_kind = req.kind
            self._pending_use_storyboard = req.use_storyboard
            self._hide_progress()  # the progress dialog must not sit on top of the Create Drawing dialog
            self.ui.messageBox(dd.ui_route_instructions(req.kind, self.settings, req.use_storyboard), "DrawingSet")
            if not dd.start_create_drawing_ui(self.app, self.log):
                raise RuntimeError("Не удалось запустить команду «Создать чертёж».")
            self.waiting_for = req.kind
            return WAIT
        raise RuntimeError("Нет ни API, ни команды UI для создания чертежа.")

    def _after_ui_drawing(self, kind: str) -> None:
        import adsk.drawing as drw  # type: ignore
        doc = self.app.activeDocument
        drawing_doc = drw.DrawingDocument.cast(doc) if doc is not None else None
        if drawing_doc is None:
            for i in range(self.app.documents.count):
                d = self.app.documents.item(i)
                if drw.DrawingDocument.cast(d) is not None and d not in self.generated_drawings:
                    drawing_doc = drw.DrawingDocument.cast(d)
            if drawing_doc is None:
                raise RuntimeError(f"[{kind}] после диалога не найден открытый чертёж.")
        self._finish_drawing(kind, drawing_doc)

    def _finish_drawing(self, kind: str, drawing_doc: Any) -> None:
        s = self.settings
        self.generated_drawings.append(drawing_doc)
        if kind in (dd.KIND_ASSEMBLY, dd.KIND_SUMMARY) and s.asm_parts_list and self.caps.drawing_sheets:
            dd.add_custom_table(drawing_doc, bom.spec_table_cells(self.rows), self.log)
        name = self.base_name(kind)
        if s.export_pdf:
            p = export.export_pdf(drawing_doc, os.path.join(s.out_dir, name + ".pdf"), self.log)
            if p:
                self.outputs.append(p)
        if s.export_dwg:
            cmd = s.dwg_command_id or (self.caps.dwg_commands[0] if len(self.caps.dwg_commands) == 1 else "")
            if export.export_by_command(self.app, cmd, f"[{kind}] DWG", self.log):
                self.manual_steps.append(f"{kind}: DWG — завершите диалог экспорта, имя файла: {name}.dwg")
            else:
                self.manual_steps.append(f"{kind}: DWG не экспортирован — API не поддерживает, укажите id команды в настройках.")
        if s.export_dxf:
            cmd = s.dxf_command_id or (self.caps.dxf_commands[0] if len(self.caps.dxf_commands) == 1 else "")
            if export.export_by_command(self.app, cmd, f"[{kind}] DXF", self.log):
                self.manual_steps.append(f"{kind}: DXF — завершите диалог экспорта, имя файла: {name}.dxf")
            else:
                self.manual_steps.append(f"{kind}: DXF листа не экспортирован — API не поддерживает, укажите id команды в настройках.")
        try:
            drawing_doc.save(f"DrawingSet: {kind}")
        except Exception as exc:
            self.log.warn(f"[{kind}] чертёж не сохранён: {exc}")
        if s.close_drawings_after_export:
            try:
                drawing_doc.close(False)
            except Exception:
                pass
        self._activate_design()
        self._post_kind(kind)

    def _post_kind(self, kind: str) -> None:
        """Per-kind clean-up that must run on both the API and the UI route."""
        if kind == dd.KIND_EXPLODE:
            if self.copy_doc is not None:
                self._cleanup_copy()
            else:
                self._back_to_design_workspace()
        elif kind == dd.KIND_DETAILS:
            self._flat_pattern_dxf()
        elif kind == dd.KIND_SUMMARY:
            self._back_to_design_workspace()

    def _activate_design(self) -> None:
        try:
            if self.doc is not None and not self.doc.isActive:
                self.doc.activate()
        except Exception:
            pass

    # ------------------------------------------------------------------
    def step_assembly(self) -> Any:
        self._activate_design()
        req = self._request(dd.KIND_ASSEMBLY, self.doc.dataFile)
        result = self._make_drawing(req)
        if result == WAIT:
            return WAIT
        self._finish_drawing(dd.KIND_ASSEMBLY, result)

    def step_explode(self) -> Any:
        s = self.settings
        self._activate_design()
        method = s.explode_method
        storyboard = explode_fusion.find_storyboard(self.design, s.storyboard_name)
        if method == "auto":
            method = "storyboard" if storyboard is not None else "copy"
            self.log.info(f"Способ взрыв-схемы: {method} (auto)")
        if method == "storyboard":
            if storyboard is None:
                self.log.warn(f"Раскадровка «{s.storyboard_name}» не найдена — переход к разнесённой копии.")
                method = "copy"
            else:
                explode_fusion.activate_storyboard(self.design, storyboard, self.log)
                self.log.info("Предположение: автосоздание берёт активную раскадровку; при несовпадении проверьте лист вручную.")
                req = self._request(dd.KIND_EXPLODE, self.doc.dataFile, use_storyboard=True)
                result = self._make_drawing(req)
                if result == WAIT:
                    return WAIT
                self._finish_drawing(dd.KIND_EXPLODE, result)
                return None
        # copy route
        copy_doc, copy_df, res = explode_fusion.build_exploded_copy(self.app, self.doc, self.design, self.data, s, self.log)
        self.copy_doc, self.copy_df, self.explode_result = copy_doc, copy_df, res
        req = self._request(dd.KIND_EXPLODE, copy_df, exploded_copy=True)
        result = self._make_drawing(req)
        if result == WAIT:
            return WAIT
        self._finish_drawing(dd.KIND_EXPLODE, result)

    def _cleanup_copy(self) -> None:
        if self.copy_doc is None:
            return
        try:
            self.copy_doc.close(False)
        except Exception:
            pass
        if not self.settings.keep_intermediate_docs and self.copy_df is not None:
            try:
                if self.copy_df.deleteMe():
                    self.log.info("Разнесённая копия удалена из проекта.")
            except Exception as exc:
                self.log.warn(f"Разнесённую копию не удалось удалить: {exc}")
        self.copy_doc = None
        self._activate_design()

    def _back_to_design_workspace(self) -> None:
        try:
            ws = self.ui.workspaces.itemById("FusionSolidEnvironment")
            if ws is not None and not ws.isActive:
                ws.activate()
        except Exception:
            pass

    def step_details(self) -> Any:
        s = self.settings
        self._activate_design()
        req = self._request(dd.KIND_DETAILS, self.doc.dataFile)
        result = self._make_drawing(req)
        if result == WAIT:
            return WAIT
        self._finish_drawing(dd.KIND_DETAILS, result)

    def _flat_pattern_dxf(self) -> None:
        s = self.settings
        if not (s.export_dxf and self.data and self.data.sheet_metal):
            return
        for sm in self.data.sheet_metal:
            if sm.flat_pattern is None:
                continue
            name = sanitize_filename(f"{self.base_name('ДЕТ')}_{sm.position}_{sm.title}_Развёртка")
            p = export.export_flat_pattern_dxf(self.design, sm.flat_pattern, os.path.join(s.out_dir, name + ".dxf"), self.log)
            if p:
                self.outputs.append(p)

    def step_summary(self) -> Any:
        self._activate_design()
        storyboard = explode_fusion.find_storyboard(self.design, self.settings.storyboard_name)
        use_sb = storyboard is not None and self.settings.make_explode
        if use_sb:
            explode_fusion.activate_storyboard(self.design, storyboard, self.log)
        req = self._request(dd.KIND_SUMMARY, self.doc.dataFile, use_storyboard=use_sb)
        result = self._make_drawing(req)
        if result == WAIT:
            return WAIT
        self._finish_drawing(dd.KIND_SUMMARY, result)

    # ------------------------------------------------------------------
    def step_extract(self) -> None:
        from .extract import extract_scene
        total = max(len(self.data.parts), 1)

        def progress(i: int, n: int, name: str) -> None:
            self.report(f"Геометрия: {name}", (self.index + i / n) / max(len(self.steps), 1))
            try:
                import adsk.core  # type: ignore
                adsk.doEvents()
            except Exception:
                pass

        self.scene = extract_scene(self.data, self.log, progress)
        self.log.info(f"Геометрия прочитана: деталей {len(self.scene.parts)}, развёрток {len(self.scene.flat_patterns)}")

    def step_render(self) -> None:
        overrides = spec_mod.load_overrides(self.data.product)
        if overrides:
            self.log.info(f"Загружены сохранённые настройки листов: {len(overrides)}")
        self.document = docbuild.build_document(self.data, self.scene, self.settings, self.explode_result, self.rows,
                                                overrides=overrides)
        for w in self.document.warnings:
            self.log.warn(w)
        self.log.info(f"Построено листов: {len(self.document.sheets)}")
        if self.reporter is not None:
            # metadata first, then each sheet separately: keeps the JS bridge payloads small
            self.reporter.send("sheets", {"sheets": docbuild.sheets_svg(self.document, with_svg=False),
                                          "warnings": list(self.document.warnings)})
            for i in range(len(self.document.sheets)):
                self.reporter.send("sheet_update", {"sheets": [docbuild.sheet_payload(self.document, i)]})
                try:
                    import adsk.core  # type: ignore
                    adsk.doEvents()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # AI / manual sheet editing (called from the palette actions)
    # ------------------------------------------------------------------
    def sheet_payload(self, idx: int) -> Dict[str, Any]:
        return docbuild.sheet_payload(self.document, idx)

    def apply_sheet_spec(self, sheet_spec: Dict[str, Any], save: bool = True) -> int:
        idx = docbuild.rerender_sheet(self.document, sheet_spec, self.data, self.scene, self.settings,
                                      self.explode_result, self.rows)
        if save:
            overrides = spec_mod.load_overrides(self.data.product)
            overrides[sheet_spec["id"]] = sheet_spec
            spec_mod.save_overrides(self.data.product, overrides)
        return idx

    def reset_sheet(self, sheet_id: str) -> Optional[int]:
        default = spec_mod.default_spec(self.data, self.rows, self.settings, has_flat=set(self.scene.flat_patterns))
        sh = next((x for x in default["sheets"] if x["id"] == sheet_id), None)
        if sh is None:
            return None
        overrides = spec_mod.load_overrides(self.data.product)
        overrides.pop(sheet_id, None)
        spec_mod.save_overrides(self.data.product, overrides)
        return self.apply_sheet_spec(sh, save=False)

    def ai_edit(self, sheet_id: str, message: str, apply_to_kind: bool = False) -> Dict[str, Any]:
        sh = self.document.sheet_spec(sheet_id) if self.document else None
        if sh is None:
            raise RuntimeError("Лист не найден; постройте комплект заново.")
        s = self.settings
        assistant = ai.SheetAssistant(s.ai_api_key, s.ai_model, s.ai_effort)
        summary = ai.model_summary(self.data, self.rows, self.scene)
        history = self.ai_history.get(sheet_id, [])[-6:]
        result = assistant.edit_sheet(sh, summary, message, history)
        self.ai_history.setdefault(sheet_id, []).extend([
            {"role": "user", "content": message},
            {"role": "assistant", "content": result.explanation or "OK"},
        ])
        updated: List[int] = []
        if not result.refused:
            updated.append(self.apply_sheet_spec(result.sheet))
            if apply_to_kind:
                for other in list(self.document.spec.get("sheets", [])):
                    if other["kind"] == sh["kind"] and other["id"] != sh["id"]:
                        clone = json.loads(json.dumps(result.sheet))
                        clone["id"], clone["subject"], clone["title"] = other["id"], other["subject"], other["title"]
                        clone["header"], clone["material"] = other.get("header", ""), other.get("material", "")
                        updated.append(self.apply_sheet_spec(clone))
        return {"explanation": result.explanation, "model": result.model, "usage": result.usage,
                "refused": result.refused, "updated": updated}

    def step_export_render(self) -> None:
        if self.document is None or self.scene is None:
            raise RuntimeError("Сначала постройте листы («Сгенерировать»).")
        self.outputs += docbuild.export_document(self.document, self.data, self.scene, self.settings, self.rows, self.log)
        if self.settings.export_csv:
            self.outputs += export.write_tables(self.settings.out_dir, self.base_name(), self.rows, self.data.bends, self.log)

    def step_finish(self) -> None:
        self.done = True
        # resume() increments index after the last UI step; make sure copies are gone
        if self.copy_doc is not None:
            self._cleanup_copy()
        path = self.write_report()
        self._hide_progress()
        self._activate_design()
        summary = [f"Готово. Файлы: {len(self.outputs)}", f"Папка: {self.settings.out_dir}"]
        if self.log.warnings:
            summary.append(f"Предупреждений: {len(self.log.warnings)} (см. отчёт)")
        if self.manual_steps:
            summary.append("Ручные шаги:\n  - " + "\n  - ".join(self.manual_steps))
        summary.append(f"Отчёт: {path}")
        if self.reporter is not None:
            if self.mode == "export":
                self.reporter.send("done", {"files": list(self.outputs), "out_dir": self.settings.out_dir})
            for m in self.manual_steps:
                self.reporter.send("log", {"level": "warn", "message": m})
            self.reporter.send("log", {"level": "info", "message": f"Отчёт: {path}"})
        elif self.mode != "render":
            self.ui.messageBox("\n".join(summary), "DrawingSet")

    # ------------------------------------------------------------------
    def write_report(self, failed: bool = False) -> str:
        s = self.settings
        os.makedirs(s.out_dir, exist_ok=True)
        base = self.base_name("ОТЧЁТ") if self.data else "DrawingSet_ОТЧЁТ"
        path = os.path.join(s.out_dir, base + ".txt")
        lines = [
            f"DrawingSet — отчёт {_dt.datetime.now():%Y-%m-%d %H:%M}" + (" (ОШИБКА)" if failed else ""),
            f"Документ: {getattr(self.doc, 'name', '?')}",
            "",
            "Возможности API:", self.caps.report(), "",
        ]
        if self.data:
            d = self.data
            lines += [f"Проект: {d.project}   Вид: {d.view}   Изделие: {d.product}", "",
                      "Спецификация:", table_text(bom.SPEC_HEADER, bom.spec_rows(self.rows)), ""]
            hw = bom.hardware_rows(self.rows)
            if hw:
                lines += ["Фурнитура:", table_text(bom.HARDWARE_HEADER, hw), ""]
            br = bom.bend_rows(d.bends)
            if br:
                lines += ["Гибы:", table_text(bom.BEND_HEADER, br), ""]
            if d.section_markers:
                lines += ["Маркеры разрезов: " + "; ".join(d.section_markers), ""]
            if self.explode_result is not None:
                by_id = {it.id: it for it in d.explode_items}
                rows = []
                for it in d.explode_items:
                    off = self.explode_result.world_offset(by_id, it.id)
                    hidden = "скрыт" if it.id in self.explode_result.hidden else ""
                    rows.append([it.id, it.category, *(f"{c:.0f}" for c in off), hidden])
                lines += ["Разнесение (смещения в мм, мировые оси):",
                          table_text(["Вхождение", "Категория", "dX", "dY", "dZ", ""], rows), ""]
                lines += [f"- {n}" for n in self.explode_result.notes] + [""]
        if self.outputs:
            lines += ["Файлы:"] + [f"  {p}" for p in self.outputs] + [""]
        if self.manual_steps:
            lines += ["Ручные шаги:"] + [f"  - {m}" for m in self.manual_steps] + [""]
        if self.log.warnings:
            lines += ["Предупреждения:"] + [f"  - {w}" for w in self.log.warnings] + [""]
        lines += [f"Лог: {self.log.path}"]
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        self.log.info(f"Отчёт: {path}")
        return path
