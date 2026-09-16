"""Settings of the DrawingSet add-in: defaults, validation, JSON persistence.

The settings object is a plain dataclass so that it can be filled from the
command dialog, from a JSON file or from tests without Fusion running.
"""
from __future__ import annotations

import dataclasses
import json
import os
from dataclasses import dataclass, field, fields
from typing import Any, Dict

# Component name pattern: {project}_{view}_{position}_{title}, e.g. "37-4_В1_П03_Боковина".
DEFAULT_NAME_REGEX = (
    r"^(?P<project>[^_]+)_(?P<view>[^_]+)_(?P<pos>[A-Za-zА-Яа-я]?\d+[A-Za-zА-Яа-я]?)_(?P<title>.+)$"
)

DEFAULT_HARDWARE_KEYWORDS = (
    "винт,шуруп,саморез,конфирмат,евровинт,стяжка,минификс,рафикс,эксцентрик,шкант,"
    "полкодержател,петл,направляющ,ручк,опора,ножк,подпятник,уголок,крепеж,крепёж,"
    "гайк,шайб,заклепк,заклёпк,болт,bolt,screw,nut,washer,dowel,hinge,slide,handle,leg,"
    "cam,rivet,insert,bracket"
)

# Category keywords used by the explode algorithm (lower-case substrings).
DEFAULT_CATEGORY_KEYWORDS: Dict[str, str] = {
    "back": "задн,зад.,back,rear",
    "facade": "фасад,двер,front door,door,facade",
    "shelf": "полк,shelf",
    "top": "крышк,верх,столешн,top",
    "bottom": "дно,дниш,низ,bottom,base",
    "side": "бок,стенк,перегород,side,wall,partition,divider",
    "drawer": "ящик,drawer",
}

SETTINGS_FILE_NAME = "DrawingSet.settings.json"


@dataclass
class Settings:
    # ---- Комплект ----
    make_assembly: bool = True          # СБ
    make_explode: bool = True           # ВЗР
    make_details: bool = True           # ДЕТ

    # ---- Общие параметры листа ----
    standard: str = "ISO"               # ISO | ASME
    units: str = "mm"                   # mm | in
    sheet_size: str = "A3"              # A4..A0 (ISO) or A..E (ASME)
    orientation: str = "Landscape"      # Landscape | Portrait
    view_style: str = "VisibleEdges"    # VisibleEdges | VisibleAndHiddenEdges | Shaded | ShadedWithVisibleEdges

    # ---- СБ ----
    asm_iso_view: bool = True
    asm_ortho_views: bool = True        # главный, сверху, слева
    asm_overall_dims: bool = True       # габаритные
    asm_mounting_dims: bool = False     # присоединительные и установочные (стратегия Automatic вместо Overall)
    asm_parts_list: bool = True         # позиции + спецификация
    asm_subassembly_sheets: bool = False
    asm_sections: bool = False          # разрезы/выносные виды по маркерам (ручной шаг, см. README)
    section_marker_prefix: str = "РАЗРЕЗ"
    parts_list_location: str = "TopRight"

    # ---- ВЗР ----
    explode_method: str = "auto"        # auto | storyboard | copy
    storyboard_name: str = "[EXPLODE]"
    explode_factor: float = 3.0         # смещение = max(factor × толщина, step_mm)
    explode_step_mm: float = 60.0
    explode_facade_mult: float = 2.0
    explode_back_mult: float = 1.5
    explode_shelf_mult: float = 1.0
    explode_stagger: float = 0.35       # доп. смещение по рангу (доля базового шага), 0 = выкл.
    explode_sub_scale: float = 0.6      # масштаб разнесения внутри подсборок
    explode_subassemblies: bool = False # отдельная схема на каждую подсборку
    explode_shaded: bool = False        # затенённый стиль вида на взрыв-схеме
    hardware_mode: str = "hide"         # hide | attach | show
    hardware_table: bool = True         # таблица фурнитуры (CSV + описание)
    up_axis: str = "Y"                  # Y | Z — вертикальная ось модели
    front_axis: str = "-Z"              # запасное направление "перёд", если не найдена задняя стенка

    # ---- ДЕТ ----
    det_ortho_views: bool = True
    det_iso_view: bool = True
    det_auto_dims: bool = True
    det_dim_strategy: str = "Baseline"  # Overall | Automatic | Baseline | Chain
    det_hole_notes: bool = True
    det_origin: str = "BottomLeft"      # ModelOrigin | BottomLeft | BottomRight | TopLeft | TopRight
    det_center_marks: bool = True
    det_edge_banding: bool = True       # кромка в примечании/описании
    sheet_metal_flat: bool = True       # развёртка
    sheet_metal_folded: bool = False    # лист согнутой модели
    sheet_metal_bend_table: bool = True

    # ---- Экспорт ----
    drawing_engine: str = "own"         # own — собственный рендер в палитре; fusion — через Drawing API/диалог Fusion
    out_dir: str = ""
    export_pdf: bool = True
    export_dxf: bool = False            # DXF листов (собственный рендер) / команда UI (движок Fusion)
    export_part_dxf: bool = True        # DXF контуров деталей 1:1 для раскроя (собственный рендер)
    export_svg: bool = False
    export_dwg: bool = False            # только движок Fusion, через команду UI
    export_summary_pdf: bool = False    # один сводный PDF на изделие
    export_csv: bool = True             # спецификация, фурнитура, гибы
    file_mask: str = "{проект}_{вид}_{изделие}_{тип}"
    project_override: str = ""
    product_override: str = ""
    dxf_command_id: str = ""            # id команды экспорта DXF (см. «Проверка API»)
    dwg_command_id: str = ""

    # ---- AI-помощник ----
    ai_api_key: str = ""                # ключ Anthropic API (или переменная окружения ANTHROPIC_API_KEY)
    ai_model: str = "claude-opus-5"
    ai_effort: str = "high"             # low | medium | high | xhigh | max
    ai_apply_to_kind: bool = False      # применять правку ко всем листам того же типа

    # ---- Модель / служебные ----
    name_regex: str = DEFAULT_NAME_REGEX
    hardware_keywords: str = DEFAULT_HARDWARE_KEYWORDS
    category_keywords: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_CATEGORY_KEYWORDS))
    edge_attr_group: str = "DrawingSet"
    edge_attr_name: str = "edge"
    edge_regex: str = ""                # необязательный шаблон кромки в имени, группа (?P<edge>...)
    panel_max_thickness_mm: float = 50.0
    hardware_max_size_mm: float = 120.0
    write_component_props: bool = True  # partNumber = позиция, description = материал/толщина/размер/кромка
    save_before_run: bool = True
    keep_intermediate_docs: bool = False
    close_drawings_after_export: bool = True
    force_ui_fallback: bool = False     # всегда идти через диалог «Создать чертёж» (отладка)

    # ------------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Settings":
        known = {f.name: f for f in fields(cls)}
        kwargs: Dict[str, Any] = {}
        for key, value in (data or {}).items():
            if key not in known:
                continue
            f = known[key]
            if f.type in ("bool", bool):
                kwargs[key] = bool(value)
            elif f.type in ("float", float):
                try:
                    kwargs[key] = float(value)
                except (TypeError, ValueError):
                    continue
            elif f.type in ("str", str):
                kwargs[key] = "" if value is None else str(value)
            else:
                kwargs[key] = value
        return cls(**kwargs)

    def validate(self) -> list[str]:
        """Returns a list of human readable problems (Russian), empty if OK."""
        problems: list[str] = []
        if not (self.make_assembly or self.make_explode or self.make_details or self.export_summary_pdf):
            problems.append("Не выбран ни один модуль комплекта (СБ / ВЗР / ДЕТ / сводный PDF).")
        if self.explode_method not in ("auto", "storyboard", "copy"):
            problems.append("Способ построения взрыв-схемы должен быть auto, storyboard или copy.")
        if self.hardware_mode not in ("hide", "attach", "show"):
            problems.append("Режим крепежа должен быть hide, attach или show.")
        if self.explode_factor <= 0 and self.explode_step_mm <= 0:
            problems.append("Коэффициент и шаг разнесения не могут быть одновременно нулевыми.")
        if self.drawing_engine not in ("own", "fusion"):
            problems.append("Движок чертежей должен быть own или fusion.")
        if self.standard not in ("ISO", "ASME"):
            problems.append("Стандарт должен быть ISO или ASME.")
        if self.units not in ("mm", "in"):
            problems.append("Единицы должны быть mm или in.")
        if "{тип}" not in self.file_mask and "{type}" not in self.file_mask:
            problems.append("Маска имени файла должна содержать {тип}.")
        try:
            import re
            rx = re.compile(self.name_regex)
            if "pos" not in rx.groupindex:
                problems.append("Шаблон имени компонента должен содержать группу (?P<pos>...).")
        except re.error as exc:  # pragma: no cover - depends on user input
            problems.append(f"Шаблон имени компонента не компилируется: {exc}")
        return problems


# ----------------------------------------------------------------------
# Persistence
# ----------------------------------------------------------------------
def user_data_dir() -> str:
    base = os.path.join(os.path.expanduser("~"), "DrawingSet")
    os.makedirs(base, exist_ok=True)
    return base


def default_out_dir() -> str:
    return os.path.join(user_data_dir(), "out")


def settings_path() -> str:
    return os.path.join(user_data_dir(), SETTINGS_FILE_NAME)


def load_settings(path: str | None = None) -> Settings:
    path = path or settings_path()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        settings = Settings.from_dict(data)
    except (OSError, ValueError):
        settings = Settings()
    if not settings.out_dir:
        settings.out_dir = default_out_dir()
    return settings


def save_settings(settings: Settings, path: str | None = None) -> str:
    path = path or settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(settings.to_dict(), fh, ensure_ascii=False, indent=2)
    return path
