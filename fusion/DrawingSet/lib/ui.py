"""Command dialog: builds the inputs from Settings and reads them back."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .config import Settings, default_out_dir

DROPDOWNS: Dict[str, List[Tuple[str, str]]] = {
    "standard": [("ISO", "ISO"), ("ASME", "ASME")],
    "units": [("mm", "мм"), ("in", "дюймы")],
    "sheet_size": [("A4", "A4"), ("A3", "A3"), ("A2", "A2"), ("A1", "A1"), ("A0", "A0"),
                   ("A", "ANSI A"), ("B", "ANSI B"), ("C", "ANSI C"), ("D", "ANSI D"), ("E", "ANSI E")],
    "orientation": [("Landscape", "Альбомная"), ("Portrait", "Книжная")],
    "view_style": [("VisibleEdges", "Видимые кромки"), ("VisibleAndHiddenEdges", "Видимые и скрытые"),
                   ("Shaded", "Затенённый"), ("ShadedWithVisibleEdges", "Затенённый с кромками")],
    "parts_list_location": [("TopRight", "Справа сверху"), ("TopLeft", "Слева сверху"),
                            ("BottomRight", "Справа снизу"), ("BottomLeft", "Слева снизу")],
    "explode_method": [("auto", "Авто: раскадровка, иначе копия"), ("storyboard", "Раскадровка конструктора"),
                       ("copy", "Разнесённая копия дизайна")],
    "hardware_mode": [("hide", "Скрыть"), ("attach", "Едет вместе с деталью"), ("show", "Показать на месте")],
    "up_axis": [("Y", "Y вверх"), ("Z", "Z вверх")],
    "front_axis": [("-Z", "-Z"), ("+Z", "+Z"), ("-Y", "-Y"), ("+Y", "+Y"), ("-X", "-X"), ("+X", "+X")],
    "det_dim_strategy": [("Baseline", "От базы"), ("Chain", "Цепочка"), ("Automatic", "Автоматически"),
                         ("Overall", "Только габариты")],
    "det_origin": [("BottomLeft", "Левый нижний угол"), ("BottomRight", "Правый нижний"),
                   ("TopLeft", "Левый верхний"), ("TopRight", "Правый верхний"), ("ModelOrigin", "Начало модели")],
    "drawing_engine": [("own", "Собственный рендер (палитра, PDF/DXF/SVG)"), ("fusion", "Через Fusion Drawing")],
    "ai_model": [("claude-opus-5", "Claude Opus 5"), ("claude-sonnet-5", "Claude Sonnet 5"),
                 ("claude-fable-5-1", "Claude Fable 5.1"), ("claude-haiku-4-5", "Claude Haiku 4.5")],
    "ai_effort": [("high", "high"), ("medium", "medium"), ("low", "low"), ("xhigh", "xhigh"), ("max", "max")],
}

FLOATS: Dict[str, Tuple[float, float, float]] = {   # min, max, step
    "explode_factor": (0.0, 50.0, 0.5),
    "explode_step_mm": (0.0, 2000.0, 10.0),
    "explode_facade_mult": (0.0, 10.0, 0.25),
    "explode_back_mult": (0.0, 10.0, 0.25),
    "explode_shelf_mult": (0.0, 10.0, 0.25),
    "explode_stagger": (0.0, 3.0, 0.05),
    "explode_sub_scale": (0.05, 1.0, 0.05),
    "panel_max_thickness_mm": (1.0, 200.0, 1.0),
    "hardware_max_size_mm": (1.0, 1000.0, 10.0),
}

# (tab id, tab title, [(field, label)])
LAYOUT: List[Tuple[str, str, List[Tuple[str, str]]]] = [
    ("tab_set", "Комплект", [
        ("drawing_engine", "Движок чертежей"),
        ("make_assembly", "А. Сборочный чертёж (СБ)"),
        ("make_explode", "Б. Взрыв-схема (ВЗР)"),
        ("make_details", "В. Деталировка (ДЕТ)"),
        ("export_summary_pdf", "Один сводный PDF на изделие"),
        ("standard", "Стандарт"), ("units", "Единицы"), ("sheet_size", "Формат листа"),
        ("orientation", "Ориентация"), ("view_style", "Стиль видов"),
    ]),
    ("tab_asm", "СБ", [
        ("asm_iso_view", "Изометрия"),
        ("asm_ortho_views", "Главный вид, сверху, слева"),
        ("asm_overall_dims", "Габаритные размеры"),
        ("asm_mounting_dims", "Присоединительные и установочные размеры"),
        ("asm_parts_list", "Позиционные выноски и спецификация"),
        ("parts_list_location", "Положение спецификации"),
        ("asm_subassembly_sheets", "Листы на подсборки"),
        ("asm_sections", "Разрезы и выносные виды по маркерам (ручной шаг)"),
        ("section_marker_prefix", "Префикс маркеров (плоскости/эскизы)"),
    ]),
    ("tab_exp", "ВЗР", [
        ("explode_method", "Способ построения"),
        ("storyboard_name", "Имя раскадровки"),
        ("explode_factor", "Смещение: коэффициент × толщина"),
        ("explode_step_mm", "Минимальный шаг, мм"),
        ("explode_facade_mult", "Множитель для фасадов"),
        ("explode_back_mult", "Множитель для задней стенки"),
        ("explode_shelf_mult", "Множитель для полок (вперёд)"),
        ("explode_stagger", "Ступенчатость параллельных панелей"),
        ("explode_subassemblies", "Отдельная схема на каждую подсборку"),
        ("explode_sub_scale", "Масштаб разнесения внутри подсборок"),
        ("hardware_mode", "Крепёж"),
        ("hardware_table", "Таблица фурнитуры"),
        ("explode_shaded", "Затенённый вид на взрыв-схеме"),
        ("up_axis", "Вертикальная ось модели"),
        ("front_axis", "«Перёд», если нет задней стенки"),
    ]),
    ("tab_det", "ДЕТ", [
        ("det_ortho_views", "Ортогональные виды"),
        ("det_iso_view", "Изометрия"),
        ("det_auto_dims", "Авторазмеры"),
        ("det_dim_strategy", "Стратегия размеров"),
        ("det_origin", "База размеров"),
        ("det_hole_notes", "Обозначения отверстий"),
        ("det_center_marks", "Центровые метки отверстий"),
        ("det_edge_banding", "Кромка в примечании (атрибут/шаблон)"),
        ("sheet_metal_flat", "Листовой металл: развёртка"),
        ("sheet_metal_bend_table", "Листовой металл: таблица гибов"),
        ("sheet_metal_folded", "Листовой металл: лист согнутой модели"),
    ]),
    ("tab_out", "Экспорт", [
        ("out_dir", "Папка вывода"),
        ("export_pdf", "PDF"),
        ("export_dxf", "DXF листов"),
        ("export_part_dxf", "DXF контуров деталей 1:1 (раскрой)"),
        ("export_svg", "SVG листов"),
        ("export_dwg", "DWG (только движок Fusion, команда UI)"),
        ("export_csv", "CSV: спецификация, фурнитура, гибы"),
        ("file_mask", "Маска имени файла"),
        ("project_override", "Проект (пусто = из имён)"),
        ("product_override", "Изделие (пусто = имя документа)"),
        ("dxf_command_id", "Id команды экспорта DXF"),
        ("dwg_command_id", "Id команды экспорта DWG"),
        ("close_drawings_after_export", "Закрывать чертежи после экспорта"),
        ("keep_intermediate_docs", "Оставлять разнесённую копию в проекте"),
    ]),
    ("tab_ai", "AI", [
        ("ai_api_key", "Ключ Anthropic API"),
        ("ai_model", "Модель"),
        ("ai_effort", "Усилие (effort)"),
        ("ai_apply_to_kind", "Применять правку ко всем листам того же типа"),
    ]),
    ("tab_model", "Модель", [
        ("name_regex", "Шаблон имени компонента"),
        ("hardware_keywords", "Ключевые слова крепежа"),
        ("edge_attr_group", "Атрибут кромки: группа"),
        ("edge_attr_name", "Атрибут кромки: имя"),
        ("edge_regex", "Шаблон кромки в имени (группа edge)"),
        ("panel_max_thickness_mm", "Макс. толщина панели, мм"),
        ("hardware_max_size_mm", "Макс. размер крепежа, мм"),
        ("write_component_props", "Записывать partNumber/description в компоненты"),
        ("save_before_run", "Сохранять документ перед запуском"),
        ("force_ui_fallback", "Всегда через диалог «Создать чертёж» (отладка)"),
    ]),
]

BROWSE_ID = "btn_browse"


def build_inputs(inputs: Any, settings: Settings) -> None:
    import adsk.core  # type: ignore
    for tab_id, title, fields_ in LAYOUT:
        tab = inputs.addTabCommandInput(tab_id, title)
        children = tab.children
        for field_name, label in fields_:
            value = getattr(settings, field_name)
            if field_name in DROPDOWNS:
                dd = children.addDropDownCommandInput(field_name, label, adsk.core.DropDownStyles.TextListDropDownStyle)
                for key, text in DROPDOWNS[field_name]:
                    dd.listItems.add(text, key == value)
            elif field_name in FLOATS:
                lo, hi, step = FLOATS[field_name]
                children.addFloatSpinnerCommandInput(field_name, label, "", lo, hi, step, float(value))
            elif isinstance(value, bool):
                children.addBoolValueInput(field_name, label, True, "", value)
            else:
                si = children.addStringValueInput(field_name, label, str(value or ""))
                if field_name == "out_dir":
                    children.addBoolValueInput(BROWSE_ID, "Выбрать папку…", False, "", False)
                    si.tooltip = "Папка, куда будут записаны PDF/DXF/CSV и отчёт"
    note = inputs.addTextBoxCommandInput(
        "note", "",
        "Add-in читает имена и позиции, присвоенные предыдущими скриптами, и ничего не переименовывает. "
        "Настройки сохраняются в ~/DrawingSet/. Кнопка «Проверка API» показывает, что доступно в этой версии Fusion.",
        4, True)
    note.isFullWidth = True


def read_inputs(inputs: Any, base: Settings) -> Settings:
    import adsk.core  # type: ignore
    data = base.to_dict()
    for tab_id, _, fields_ in LAYOUT:
        tab = inputs.itemById(tab_id)
        scope = tab.children if tab is not None and hasattr(tab, "children") else inputs
        for field_name, _label in fields_:
            inp = scope.itemById(field_name) or inputs.itemById(field_name)
            if inp is None:
                continue
            if field_name in DROPDOWNS:
                dd = adsk.core.DropDownCommandInput.cast(inp)
                text = dd.selectedItem.name if dd.selectedItem else ""
                for key, label in DROPDOWNS[field_name]:
                    if label == text:
                        data[field_name] = key
            elif field_name in FLOATS:
                data[field_name] = float(adsk.core.FloatSpinnerCommandInput.cast(inp).value)
            elif isinstance(data.get(field_name), bool):
                data[field_name] = bool(adsk.core.BoolValueCommandInput.cast(inp).value)
            else:
                data[field_name] = adsk.core.StringValueCommandInput.cast(inp).value
    s = Settings.from_dict(data)
    if not s.out_dir:
        s.out_dir = default_out_dir()
    return s


def handle_input_changed(args: Any, ui: Any) -> None:
    """Folder picker button."""
    import adsk.core  # type: ignore
    changed = args.input
    if changed.id != BROWSE_ID:
        return
    dlg = ui.createFolderDialog()
    dlg.title = "Папка для комплекта чертежей"
    if dlg.showDialog() == adsk.core.DialogResults.DialogOK:
        target = adsk.core.StringValueCommandInput.cast(args.inputs.itemById("out_dir"))
        if target is not None:
            target.value = dlg.folder


# ----------------------------------------------------------------------
def schema(settings: Settings) -> List[Dict[str, Any]]:
    """Form description for the HTML palette (same layout as the native dialog)."""
    out: List[Dict[str, Any]] = []
    for tab_id, title, fields_ in LAYOUT:
        fields: List[Dict[str, Any]] = []
        for key, label in fields_:
            value = getattr(settings, key)
            if key in DROPDOWNS:
                fields.append({"key": key, "label": label, "type": "select", "options": DROPDOWNS[key]})
            elif key in FLOATS:
                lo, hi, step = FLOATS[key]
                fields.append({"key": key, "label": label, "type": "float", "min": lo, "max": hi, "step": step})
            elif isinstance(value, bool):
                fields.append({"key": key, "label": label, "type": "bool"})
            else:
                fields.append({"key": key, "label": label, "type": "text"})
        out.append({"id": tab_id, "title": title, "fields": fields})
    return out
