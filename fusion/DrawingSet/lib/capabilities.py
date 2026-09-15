"""Runtime probing of the Fusion API: what this installation can and cannot do.

Facts checked against the official API reference (Fusion May 2026 release):
  * ``adsk.drawing`` publicly contains only Drawing / DrawingDocument / DrawingExportManager /
    PDFExportOptions. Sheets, views, dimensions, balloons and parts lists have no public API.
  * The C++ headers of the same release ship a *hidden, unsupported* ``DrawingManager`` with
    ``createDrawingInput`` / ``createDrawing`` and ``AutomationPreferences`` (main/sub-assembly
    sheets, animation (exploded) sheets, component sheets, folded/flat pattern sheets,
    auto-dimensioning, parts list). Whether it is exposed to Python is probed here at runtime.
  * ``AnimationManager`` / ``Storyboards.add`` exist; there is no API to create explode
    actions or to transform components inside a storyboard.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass
class Capabilities:
    fusion_version: str = ""
    drawing_module: bool = False
    drawing_manager: bool = False           # adsk.drawing.DrawingManager (hidden API)
    drawing_input: bool = False             # adsk.drawing.CreateDrawingInput
    drawing_sheets: bool = False            # Drawing.sheets / Sheet.customTables
    pdf_export: bool = False
    animation_manager: bool = False
    storyboards_add: bool = False
    storyboard_explode_api: bool = False    # any explode/transform action API on Storyboard
    create_drawing_command: bool = False    # UI command NewFusionDrawingDocumentCommand
    dxf_commands: List[str] = field(default_factory=list)
    dwg_commands: List[str] = field(default_factory=list)
    flat_pattern_api: bool = False
    notes: List[str] = field(default_factory=list)

    def report(self) -> str:
        def yn(v: bool) -> str:
            return "да" if v else "нет"
        lines = [
            f"Fusion: {self.fusion_version or '?'}",
            f"Модуль adsk.drawing: {yn(self.drawing_module)}",
            f"  DrawingManager (автосоздание чертежей, скрытый API): {yn(self.drawing_manager)}",
            f"  CreateDrawingInput / AutomationPreferences: {yn(self.drawing_input)}",
            f"  Drawing.sheets / CustomTables: {yn(self.drawing_sheets)}",
            f"  Экспорт PDF через API: {yn(self.pdf_export)}",
            f"AnimationManager: {yn(self.animation_manager)}",
            f"  Storyboards.add: {yn(self.storyboards_add)}",
            f"  API разнесения/трансформации в раскадровке: {yn(self.storyboard_explode_api)}",
            f"Команда UI «Создать чертёж» (NewFusionDrawingDocumentCommand): {yn(self.create_drawing_command)}",
            f"Команды экспорта DXF: {', '.join(self.dxf_commands) or 'не найдены'}",
            f"Команды экспорта DWG: {', '.join(self.dwg_commands) or 'не найдены'}",
            f"Развёртка листового металла (createFlatPattern/getBendInfo): {yn(self.flat_pattern_api)}",
        ]
        if self.notes:
            lines.append("")
            lines.extend(f"- {n}" for n in self.notes)
        return "\n".join(lines)

    @property
    def drawing_route(self) -> str:
        """'api' when drawings can be created without user interaction, else 'ui'."""
        if self.drawing_manager and self.drawing_input:
            return "api"
        return "ui" if self.create_drawing_command else "none"


def probe(app=None) -> Capabilities:
    caps = Capabilities()
    try:
        import adsk.core  # type: ignore
        import adsk.fusion  # type: ignore
    except Exception as exc:  # pragma: no cover - outside Fusion
        caps.notes.append(f"adsk не импортируется: {exc}")
        return caps

    app = app or adsk.core.Application.get()
    try:
        caps.fusion_version = app.version
    except Exception:
        pass

    try:
        import adsk.drawing  # type: ignore
        caps.drawing_module = True
        caps.drawing_manager = hasattr(adsk.drawing, "DrawingManager")
        caps.drawing_input = hasattr(adsk.drawing, "CreateDrawingInput") and hasattr(adsk.drawing, "AutomationPreferences")
        caps.drawing_sheets = hasattr(adsk.drawing, "Sheets") and hasattr(adsk.drawing, "CustomTables")
        caps.pdf_export = hasattr(adsk.drawing, "PDFExportOptions")
        if caps.drawing_manager:
            try:
                dm = adsk.drawing.DrawingManager.get()
                if dm is None:
                    caps.notes.append("DrawingManager.get() вернул None — автосоздание недоступно.")
                    caps.drawing_manager = False
            except Exception as exc:
                caps.notes.append(f"DrawingManager.get() упал: {exc}")
                caps.drawing_manager = False
        else:
            caps.notes.append(
                "В этой сборке Python не видит adsk.drawing.DrawingManager: чертёж будет создан через "
                "диалог «Создать чертёж» (режим Automatic), add-in подхватит результат и выполнит экспорт.")
    except Exception as exc:
        caps.notes.append(f"adsk.drawing не импортируется: {exc}")

    caps.animation_manager = hasattr(adsk.fusion, "AnimationManager")
    caps.storyboards_add = hasattr(adsk.fusion, "Storyboards") and hasattr(adsk.fusion.Storyboards, "add")
    sb_attrs = [a for a in dir(getattr(adsk.fusion, "Storyboard", object))
                if any(k in a.lower() for k in ("explode", "transform", "action"))]
    caps.storyboard_explode_api = bool(sb_attrs)
    if sb_attrs:
        caps.notes.append(f"У Storyboard найдены члены: {', '.join(sb_attrs)} — проверьте, можно ли ими строить разнесение.")
    else:
        caps.notes.append("API разнесения в раскадровке нет: используется раскадровка конструктора или разнесённая копия.")

    caps.flat_pattern_api = hasattr(adsk.fusion.Component, "createFlatPattern") and hasattr(adsk.fusion, "FlatPattern")

    try:
        ui = app.userInterface
        caps.create_drawing_command = ui.commandDefinitions.itemById("NewFusionDrawingDocumentCommand") is not None
        for i in range(ui.commandDefinitions.count):
            cd = ui.commandDefinitions.item(i)
            cid = (cd.id or "")
            low = cid.lower()
            if "dxf" in low and ("export" in low or "drawing" in low or "sheet" in low):
                caps.dxf_commands.append(cid)
            if "dwg" in low and ("export" in low or "drawing" in low or "sheet" in low):
                caps.dwg_commands.append(cid)
    except Exception as exc:
        caps.notes.append(f"Не удалось перечислить команды UI: {exc}")
    return caps
