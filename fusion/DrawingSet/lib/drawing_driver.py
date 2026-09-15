"""Creates drawing documents.

Route "api": the hidden ``adsk.drawing.DrawingManager`` (present in the C++ headers of the
May 2026 release, marked "hidden and not officially supported"). Everything is accessed with
``getattr`` so that the add-in degrades gracefully when a member is missing.

Route "ui": the "Create Drawing" command (``NewFusionDrawingDocumentCommand``) is started for
the active design; the user confirms the dialog and the pipeline continues when the command
terminates (see lib.pipeline).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional

from .config import Settings

KIND_ASSEMBLY = "СБ"
KIND_EXPLODE = "ВЗР"
KIND_DETAILS = "ДЕТ"
KIND_SUMMARY = "СВОД"

CREATE_DRAWING_CMD = "NewFusionDrawingDocumentCommand"


@dataclass
class DrawingRequest:
    kind: str
    data_file: Any                     # adsk.core.DataFile of the source design
    use_storyboard: bool = False       # animation (exploded) sheets from the active storyboard
    exploded_copy: bool = False        # the data file is already an exploded copy
    has_subassemblies: bool = False
    hardware_keywords: str = ""
    hide_hardware: bool = False
    warnings: List[str] = field(default_factory=list)


def _enum(module: Any, enum_name: str, member: str):
    enum = getattr(module, enum_name, None)
    if enum is None:
        raise AttributeError(f"adsk.drawing.{enum_name} отсутствует")
    if not hasattr(enum, member):
        raise AttributeError(f"adsk.drawing.{enum_name}.{member} отсутствует")
    return getattr(enum, member)


def _set(obj: Any, prop: str, value: Any, log=None, label: str = "") -> bool:
    """Sets a property if the object has it; logs and continues otherwise."""
    if obj is None:
        return False
    try:
        if not hasattr(obj, prop):
            if log:
                log.warn(f"{label or type(obj).__name__}.{prop} недоступно в этой версии API — пропущено.")
            return False
        setattr(obj, prop, value)
        return True
    except Exception as exc:
        if log:
            log.warn(f"Не удалось задать {label or type(obj).__name__}.{prop} = {value!r}: {exc}")
        return False


def _get(obj: Any, prop: str):
    try:
        return getattr(obj, prop)
    except Exception:
        return None


# ----------------------------------------------------------------------
def configure_input(inp: Any, req: DrawingRequest, settings: Settings, log=None) -> None:
    import adsk.drawing as drw  # type: ignore

    # sheet format ---------------------------------------------------
    _set(inp, "standard", _enum(drw, "DrawingStandardTypes", f"{settings.standard}DrawingStandardType"), log, "CreateDrawingInput")
    _set(inp, "units", _enum(drw, "DrawingUnitTypes",
                             "MillimeterDrawingUnitType" if settings.units == "mm" else "InchDrawingUnitType"), log, "CreateDrawingInput")
    if settings.standard == "ISO":
        _set(inp, "isoSheetSize", _enum(drw, "ISOSheetSizes", f"{settings.sheet_size}ISOSheetSize"), log, "CreateDrawingInput")
    else:
        _set(inp, "asmeSheetSize", _enum(drw, "ASMESheetSizes", f"{settings.sheet_size}ASMESheetSize"), log, "CreateDrawingInput")
    _set(inp, "orientationType", _enum(drw, "SheetOrientationTypes", f"{settings.orientation}SheetOrientationType"), log, "CreateDrawingInput")
    _set(inp, "sheetCreationType", _enum(drw, "SheetCreationTypes", "AllLevelsSheetCreationType"), log, "CreateDrawingInput")

    ap = _get(inp, "automationPreferences")
    if ap is None:
        if log:
            log.warn("CreateDrawingInput.automationPreferences отсутствует: будут настройки Fusion по умолчанию.")
        return
    g = _get(ap, "globalPreferences")

    kind = req.kind
    want_main = kind in (KIND_ASSEMBLY, KIND_SUMMARY) or (kind == KIND_EXPLODE and req.exploded_copy)
    want_sub = (kind in (KIND_ASSEMBLY, KIND_SUMMARY) and settings.asm_subassembly_sheets and req.has_subassemblies) or \
               (kind == KIND_EXPLODE and req.exploded_copy and settings.explode_subassemblies and req.has_subassemblies)
    want_anim = (kind == KIND_EXPLODE and req.use_storyboard) or (kind == KIND_SUMMARY and req.use_storyboard)
    want_comp = kind in (KIND_DETAILS, KIND_SUMMARY)
    want_flat = want_comp and settings.sheet_metal_flat
    want_folded = want_comp and settings.sheet_metal_folded

    _set(g, "isMainAssemblySheetGenerated", want_main, log, "GlobalPreferences")
    _set(g, "isSubAssemblySheetGenerated", want_sub, log, "GlobalPreferences")
    _set(g, "isAnimationSheetGenerated", want_anim, log, "GlobalPreferences")
    _set(g, "isComponentSheetGenerated", want_comp, log, "GlobalPreferences")
    _set(g, "isFoldedModelSheetGenerated", want_folded, log, "GlobalPreferences")
    _set(g, "isFlatPatternSheetGenerated", want_flat, log, "GlobalPreferences")
    auto_dims = (settings.asm_overall_dims if kind in (KIND_ASSEMBLY, KIND_EXPLODE) else settings.det_auto_dims)
    _set(g, "isAutoDimensionEnabled", auto_dims, log, "GlobalPreferences")
    if req.hide_hardware and req.hardware_keywords:
        _set(g, "omitComponentsWithKeywords", req.hardware_keywords, log, "GlobalPreferences")
        _set(g, "isDetectAndOmitFasteners", True, log, "GlobalPreferences")
    else:
        _set(g, "omitComponentsWithKeywords", "", log, "GlobalPreferences")
        _set(g, "isDetectAndOmitFasteners", False, log, "GlobalPreferences")

    style_member = f"{settings.view_style}DrawingViewStyleType"
    try:
        style = _enum(drw, "DrawingViewStyleTypes", style_member)
    except AttributeError:
        style = None
    try:
        shaded = _enum(drw, "DrawingViewStyleTypes", "ShadedWithVisibleEdgesDrawingViewStyleType")
    except AttributeError:
        shaded = style
    try:
        tangent_off = _enum(drw, "TangentEdgeDisplayTypes", "OffTangentEdgeDisplayType")
    except AttributeError:
        tangent_off = None

    def view_prefs(vp: Any, use_shaded: bool = False) -> None:
        if vp is None:
            return
        chosen = shaded if use_shaded else style
        if chosen is not None:
            _set(vp, "style", chosen, log, "DrawingViewPreferences")
        if tangent_off is not None:
            _set(vp, "tangentEdgesType", tangent_off, log, "DrawingViewPreferences")
        _set(vp, "isShowInterferenceEdges", False, log, "DrawingViewPreferences")
        if settings.det_center_marks:
            try:
                _set(vp, "centerMarkType", _enum(drw, "CenterMarkDisplayTypes", "AllHolesCenterMarkDisplayType"), log)
                _set(vp, "centerLineType", _enum(drw, "CenterLineDisplayTypes", "AllHolesCenterLineDisplayType"), log)
            except AttributeError:
                pass

    loc = f"{settings.parts_list_location}TableLocationType"
    try:
        loc_enum = _enum(drw, "TableLocationTypes", loc)
    except AttributeError:
        loc_enum = None

    for name in ("mainAssemblyPreferences", "subAssemblyPreferences"):
        asm = _get(ap, name)
        if asm is None:
            continue
        iso = _get(asm, "isoViewSheetPreferences")
        ortho = _get(asm, "orthogonalViewSheetPreferences")
        if kind == KIND_EXPLODE and req.exploded_copy:
            _set(iso, "isSheetCreated", True, log, f"{name}.iso")
            _set(iso, "isPartsListIncluded", settings.asm_parts_list, log, f"{name}.iso")
            _set(ortho, "isSheetCreated", False, log, f"{name}.ortho")
        else:
            _set(iso, "isSheetCreated", settings.asm_iso_view, log, f"{name}.iso")
            _set(iso, "isPartsListIncluded", settings.asm_parts_list, log, f"{name}.iso")
            _set(ortho, "isSheetCreated", settings.asm_ortho_views, log, f"{name}.ortho")
            _set(ortho, "isPartsListIncluded", settings.asm_parts_list and not settings.asm_iso_view, log, f"{name}.ortho")
        if loc_enum is not None:
            _set(iso, "partsListLocationType", loc_enum, log, f"{name}.iso")
            _set(ortho, "partsListLocationType", loc_enum, log, f"{name}.ortho")
        ad = _get(asm, "autoDimensionPreferences")
        _set(ad, "isAutoDimensionEnabled", settings.asm_overall_dims, log, f"{name}.autoDim")
        try:
            strategy = "AutomaticDimensionStrategyType" if settings.asm_mounting_dims else "OverallDimensionStrategyType"
            _set(ad, "dimensionStrategyType", _enum(drw, "DimensionStrategyTypes", strategy), log, f"{name}.autoDim")
            _set(ad, "holePreferencesType", _enum(drw, "HolePreferencesTypes", "NoHoleAnnotationsHolePreferencesType"), log)
        except AttributeError:
            pass
        view_prefs(_get(asm, "drawingViewPreferences"), use_shaded=(kind == KIND_EXPLODE and settings.explode_shaded))

    anim = _get(ap, "animationPreferences")
    if anim is not None:
        view_prefs(_get(anim, "drawingViewPreferences"), use_shaded=settings.explode_shaded)

    comp = _get(ap, "componentPreferences")
    if comp is not None:
        sv = _get(comp, "sheetViewPreferences")
        _set(sv, "isOrthogonalViewAdded", settings.det_ortho_views, log, "componentPreferences.sheetView")
        _set(sv, "isIsometricViewAdded", settings.det_iso_view, log, "componentPreferences.sheetView")
        ad = _get(comp, "autoDimensionPreferences")
        _set(ad, "isAutoDimensionEnabled", settings.det_auto_dims, log, "componentPreferences.autoDim")
        try:
            _set(ad, "dimensionStrategyType", _enum(drw, "DimensionStrategyTypes", f"{settings.det_dim_strategy}DimensionStrategyType"), log)
            _set(ad, "holePreferencesType", _enum(drw, "HolePreferencesTypes",
                                                  "HoleNoteOnlyHolePreferencesType" if settings.det_hole_notes else "NoHoleAnnotationsHolePreferencesType"), log)
            _set(ad, "defaultOriginType", _enum(drw, "DefaultOriginTypes", f"{settings.det_origin}DefaultOriginType"), log)
        except AttributeError:
            pass
        _set(ad, "isCircularPatternDimensionsIncluded", True, log)
        view_prefs(_get(comp, "drawingViewPreferences"))

    folded = _get(ap, "foldedModelPreferences")
    if folded is not None:
        sv = _get(folded, "sheetViewPreferences")
        _set(sv, "isOrthogonalViewAdded", settings.det_ortho_views, log, "foldedModelPreferences.sheetView")
        _set(sv, "isIsometricViewAdded", settings.det_iso_view, log, "foldedModelPreferences.sheetView")
        view_prefs(_get(folded, "drawingViewPreferences"))

    flat = _get(ap, "flatPatternPreferences")
    if flat is not None:
        ov = _get(flat, "orthogonalViewSheetPreferences")
        _set(ov, "isBendTableIncluded", settings.sheet_metal_bend_table, log, "flatPatternPreferences")
        _set(ov, "isFoldedModelIsometricViewAdded", True, log, "flatPatternPreferences")
        if loc_enum is not None:
            _set(ov, "bendTableLocation", loc_enum, log, "flatPatternPreferences")
        vp = _get(flat, "drawingViewPreferences")
        _set(vp, "isShowBendExtents", True, log, "flatPatternPreferences.view")


def create_drawing_via_api(app: Any, req: DrawingRequest, settings: Settings, log=None):
    """Creates and opens the drawing. Returns the DrawingDocument."""
    import adsk.core  # type: ignore
    import adsk.drawing as drw  # type: ignore

    dm = drw.DrawingManager.get()
    if dm is None:
        raise RuntimeError("DrawingManager.get() вернул None")
    mode = _enum(drw, "DrawingCreationModes", "AutomaticDrawingCreationMode")
    inp = dm.createDrawingInput(req.data_file, mode)
    if inp is None:
        raise RuntimeError("createDrawingInput вернул None (файл не сохранён или недоступен?)")
    configure_input(inp, req, settings, log)
    if log:
        log.info(f"[{req.kind}] DrawingManager.createDrawing(...)")
    df = dm.createDrawing(inp)
    if df is None:
        raise RuntimeError("DrawingManager.createDrawing вернул None")
    if log:
        log.info(f"[{req.kind}] создан чертёж «{df.name}»")
    doc = app.documents.open(df, True)
    if doc is None:
        raise RuntimeError("Не удалось открыть созданный чертёж")
    return doc


def start_create_drawing_ui(app: Any, log=None) -> bool:
    """Starts the interactive 'Create Drawing' command for the active document."""
    ui = app.userInterface
    cmd = ui.commandDefinitions.itemById(CREATE_DRAWING_CMD)
    if cmd is None:
        if log:
            log.error(f"Команда {CREATE_DRAWING_CMD} не найдена")
        return False
    try:
        cmd.execute()
        return True
    except Exception as exc:
        if log:
            log.error(f"Не удалось запустить {CREATE_DRAWING_CMD}", exc)
        return False


def ui_route_instructions(kind: str, settings: Settings, use_storyboard: bool) -> str:
    """Text shown to the user before the interactive Create Drawing dialog."""
    sheets = []
    if kind in (KIND_ASSEMBLY, KIND_SUMMARY):
        sheets.append("Main assembly (ISO" + (" + parts list" if settings.asm_parts_list else "") +
                      (", orthogonal" if settings.asm_ortho_views else "") + ")")
        if settings.asm_subassembly_sheets:
            sheets.append("Sub-assemblies")
    if kind == KIND_EXPLODE:
        sheets.append("Animation / exploded view (раскадровка)" if use_storyboard else "Main assembly ISO (разнесённая копия)")
    if kind in (KIND_DETAILS, KIND_SUMMARY):
        sheets.append("Components (детали)" + (", Flat pattern (развёртка)" if settings.sheet_metal_flat else ""))
    return (
        f"Сейчас откроется диалог «Создать чертёж» для листа «{kind}».\n\n"
        "В диалоге выберите режим Automatic, стандарт "
        f"{settings.standard}, формат {settings.sheet_size} и включите листы:\n  • " + "\n  • ".join(sheets) +
        "\n\nПосле нажатия OK add-in дождётся создания чертежа и выполнит экспорт сам."
    )


# ----------------------------------------------------------------------
def add_custom_table(drawing_doc: Any, cells: List[List[str]], log=None) -> bool:
    """Puts the specification into a custom table on the active sheet (hidden API, best effort)."""
    try:
        import adsk.drawing as drw  # type: ignore
        drawing = drw.Drawing.cast(drawing_doc.products.itemByProductType("DrawingProductType"))
        if drawing is None:
            drawing = drawing_doc.drawing
        sheet = getattr(drawing, "activeSheet", None)
        tables = getattr(sheet, "customTables", None) if sheet is not None else None
        if tables is None:
            if log:
                log.info("CustomTables недоступны: спецификация только в CSV/отчёте.")
            return False
        rows = max(len(cells) - 1, 0)
        cols = max(len(r) for r in cells) if cells else 0
        if rows == 0 or cols == 0:
            return False
        inp = tables.createInput()
        inp.columnCount = cols
        inp.rowCount = rows
        table = tables.add(inp)
        if table is None:
            return False
        ok = True
        for r, row in enumerate(cells[1:]):
            for c, value in enumerate(row):
                try:
                    ok = table.updateCellData(r, c, str(value)) and ok
                except Exception:
                    ok = False
        if log:
            log.info(f"Спецификация добавлена как таблица {rows}×{cols} на активный лист"
                     + ("" if ok else " (часть ячеек не записалась)"))
        return True
    except Exception as exc:
        if log:
            log.warn(f"Не удалось добавить таблицу спецификации: {exc}")
        return False
