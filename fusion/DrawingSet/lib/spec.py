"""Declarative drawing specification: sheets → views / dimensions / tables / notes.

The renderer (lib.render.generic) draws whatever the spec says; the default spec is
generated from the model and settings, and the AI assistant edits sheet specs in
natural language. Everything here is plain JSON-compatible data (dicts) so it can be
stored, diffed and handed to the language model with a JSON schema.
"""
from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict, List, Optional, Sequence

from .bom import SpecRow
from .config import Settings, user_data_dir
from .model import ModelData
from .naming import sanitize_filename

SPEC_VERSION = 1

DIRECTIONS = ["front", "back", "left", "right", "top", "bottom",
              "iso", "iso_left", "iso_back", "iso_back_left", "iso_bottom"]
VIEW_STYLES = ["outline", "hidden", "shaded"]
DIM_TYPES = ["overall_w", "overall_h", "thickness", "holes_x", "holes_y", "linear"]
TABLE_TYPES = ["spec", "hardware", "bends", "custom"]
TABLE_POSITIONS = ["right", "left", "bottom_left", "bottom_right", "top_left", "top_right"]
HOLE_STRATEGIES = ["Chain", "Baseline", "Overall"]
KINDS = ["СБ", "ВЗР", "ДЕТ"]
SIZES = ["A4", "A3", "A2", "A1", "A0", "A", "B", "C", "D", "E"]


# ----------------------------------------------------------------------
# factories
# ----------------------------------------------------------------------
def view(id_: str, direction: str, *, scale: str = "auto", position: str = "auto", style: str = "outline",
         exploded: bool = False, parts: str = "all", dims: Optional[List[Dict[str, Any]]] = None,
         balloons: bool = False, label: str = "", hole_symbols: bool = False, hole_strategy: str = "Chain",
         hole_notes: bool = False, explode_scale: str = "1") -> Dict[str, Any]:
    return {"id": id_, "direction": direction, "scale": scale, "position": position, "style": style,
            "exploded": exploded, "explode_scale": explode_scale, "parts": parts, "dims": dims or [],
            "balloons": balloons, "label": label, "hole_symbols": hole_symbols, "hole_strategy": hole_strategy,
            "hole_notes": hole_notes}


def dim(type_: str, **kw: Any) -> Dict[str, Any]:
    d = {"type": type_, "side": kw.get("side", ""), "from": kw.get("from_", ""), "to": kw.get("to", ""),
         "axis": kw.get("axis", "x"), "text": kw.get("text", "")}
    return d


def table(type_: str, position: str = "right", title: str = "", rows: Optional[List[List[str]]] = None,
          columns: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": type_, "position": position, "title": title, "rows": rows or [], "columns": columns or []}


def note(text: str, position: str, size: float = 3.5, bold: bool = False) -> Dict[str, Any]:
    return {"text": text, "position": position, "size": str(size), "bold": bold}


def sheet(id_: str, kind: str, title: str, subject: str, *, size: str, orientation: str, first_angle: bool,
          views: List[Dict[str, Any]], tables: Optional[List[Dict[str, Any]]] = None,
          notes: Optional[List[Dict[str, Any]]] = None, header: str = "", material: str = "") -> Dict[str, Any]:
    return {"id": id_, "kind": kind, "title": title, "subject": subject, "size": size, "orientation": orientation,
            "first_angle": first_angle, "header": header, "material": material, "views": views,
            "tables": tables or [], "notes": notes or []}


# ----------------------------------------------------------------------
# default specification
# ----------------------------------------------------------------------
def row_key(row: SpecRow) -> str:
    return sanitize_filename(f"{row.position or 'x'}_{row.title}")


def default_spec(data: ModelData, rows: Sequence[SpecRow], settings: Settings, has_flat: Optional[set] = None) -> Dict[str, Any]:
    s = settings
    first_angle = s.standard == "ISO"
    common = dict(size=s.sheet_size, orientation=s.orientation, first_angle=first_angle)
    sheets: List[Dict[str, Any]] = []
    style = "hidden" if s.view_style == "VisibleAndHiddenEdges" else ("shaded" if s.view_style.startswith("Shaded") else "outline")

    if s.make_assembly:
        views = []
        if s.asm_ortho_views:
            views += [view("front", "front", style=style, dims=[dim("overall_h")] if s.asm_overall_dims else []),
                      view("top", "top", style=style,
                           dims=[dim("overall_w"), dim("overall_h", side="left")] if s.asm_overall_dims else []),
                      view("side", "left" if first_angle else "right", style=style)]
        if s.asm_iso_view:
            views.append(view("iso", "iso", style=style, balloons=s.asm_parts_list, label="Изометрия"))
        tables = [table("spec", "bottom_right", "Спецификация")] if s.asm_parts_list else []
        sheets.append(sheet("asm", "СБ", f"{data.product} — сборочный чертёж", "assembly", views=views, tables=tables, **common))
        if s.asm_subassembly_sheets:
            for p in data.parts:
                if p.category == "assembly":
                    sheets.append(sheet(f"asm_{sanitize_filename(p.occ_id)}", "СБ", f"Подсборка {p.position} {p.title}",
                                        f"assembly:{p.occ_id}", views=copy.deepcopy(views), tables=copy.deepcopy(tables), **common))

    if s.make_explode:
        views = [view("explode", "iso", exploded=True, style="shaded" if s.explode_shaded else style,
                      balloons=True, label="Схема разнесения")]
        tables = [table("hardware", "top_right", "Фурнитура")] if s.hardware_table else []
        sheets.append(sheet("explode", "ВЗР", f"{data.product} — схема разнесения", "assembly", views=views, tables=tables, **common))
        if s.explode_subassemblies:
            for p in data.parts:
                if p.category == "assembly":
                    sheets.append(sheet(f"explode_{sanitize_filename(p.occ_id)}", "ВЗР",
                                        f"Подсборка {p.position} {p.title} — разнесение", f"assembly:{p.occ_id}",
                                        views=copy.deepcopy(views), tables=copy.deepcopy(tables), **common))

    if s.make_details:
        for row in rows:
            if row.is_hardware:
                continue
            key = row_key(row)
            title = f"Поз. {row.position} {row.title}".strip()
            material = "  ".join(t for t in (row.material, f"{_fmt(row.thickness_mm)} мм", row.size_text(), f"{row.quantity} шт.") if t)
            header = "  ·  ".join(t for t in (row.material, f"{_fmt(row.thickness_mm)} мм" if row.thickness_mm else "",
                                              row.size_text(), f"{row.quantity} шт.", row.note) if t)
            if row.is_sheet_metal and has_flat and row.component_ids and any(c in has_flat for c in row.component_ids) and s.sheet_metal_flat:
                views = [view("flat", "flat", dims=[dim("overall_w"), dim("overall_h")], label="Развёртка")]
                tables = [table("bends", "top_right", "Гибы")] if s.sheet_metal_bend_table else []
                sheets.append(sheet(f"flat_{key}", "ДЕТ", title + " — развёртка", f"flat:{key}", views=views, tables=tables,
                                    header=header, material=material, **common))
                if not s.sheet_metal_folded:
                    continue
            main_dims = ([dim("holes_x"), dim("holes_y"), dim("overall_w"), dim("overall_h", side="right")]
                         if s.det_auto_dims else [])
            views = [view("main", "front", dims=main_dims, hole_symbols=True, hole_strategy=s.det_dim_strategy,
                          hole_notes=s.det_hole_notes)]
            if s.det_ortho_views:
                views += [view("edge_bottom", "top", dims=[dim("holes_x")] if s.det_auto_dims else [], hole_symbols=True),
                          view("edge_side", "left" if first_angle else "right",
                               dims=[dim("thickness"), dim("holes_x")] if s.det_auto_dims else [], hole_symbols=True)]
            if s.det_iso_view:
                views.append(view("iso", "iso", label="", scale="auto"))
            sheets.append(sheet(f"det_{key}", "ДЕТ", title, f"part:{key}", views=views, header=header, material=material, **common))
    return {"version": SPEC_VERSION, "sheets": sheets}


def _fmt(v: float) -> str:
    t = f"{v:.1f}".rstrip("0").rstrip(".")
    return t.replace(".", ",")


# ----------------------------------------------------------------------
# normalisation (tolerant to AI / hand edits)
# ----------------------------------------------------------------------
def normalize_sheet(sh: Dict[str, Any], template: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    base = copy.deepcopy(template) if template else sheet("x", "ДЕТ", "", "assembly", size="A3", orientation="Landscape",
                                                          first_angle=True, views=[])
    out = dict(base)
    for k, v in (sh or {}).items():
        out[k] = v
    out["kind"] = out.get("kind") if out.get("kind") in KINDS else base.get("kind", "ДЕТ")
    out["size"] = out.get("size") if out.get("size") in SIZES else base.get("size", "A3")
    out["orientation"] = "Portrait" if str(out.get("orientation", "")).lower().startswith("p") else "Landscape"
    out["first_angle"] = bool(out.get("first_angle", True))
    views = []
    for i, v in enumerate(out.get("views") or []):
        if not isinstance(v, dict):
            continue
        nv = view(str(v.get("id") or f"v{i}"), "front")
        for k in nv:
            if k in v and v[k] is not None:
                nv[k] = v[k]
        nv["id"] = str(nv["id"])
        nv["direction"] = nv["direction"] if nv["direction"] in DIRECTIONS + ["flat"] else "front"
        nv["style"] = nv["style"] if nv["style"] in VIEW_STYLES else "outline"
        nv["hole_strategy"] = nv["hole_strategy"] if nv["hole_strategy"] in HOLE_STRATEGIES else "Chain"
        nv["dims"] = [dict(dim(d.get("type", "overall_w"), side=d.get("side", ""), from_=d.get("from", ""),
                              to=d.get("to", ""), axis=d.get("axis", "x"), text=d.get("text", "")))
                      for d in (nv.get("dims") or []) if isinstance(d, dict) and d.get("type") in DIM_TYPES]
        nv["scale"] = str(nv.get("scale") or "auto")
        nv["position"] = str(nv.get("position") or "auto")
        nv["explode_scale"] = str(nv.get("explode_scale") or "1")
        for b in ("exploded", "balloons", "hole_symbols", "hole_notes"):
            nv[b] = bool(nv.get(b))
        views.append(nv)
    out["views"] = views
    out["tables"] = [table(t.get("type", "custom"), t.get("position") if t.get("position") in TABLE_POSITIONS else "right",
                           str(t.get("title") or ""), [list(map(str, r)) for r in (t.get("rows") or []) if isinstance(r, list)],
                           [str(c) for c in (t.get("columns") or [])])
                     for t in (out.get("tables") or []) if isinstance(t, dict) and t.get("type") in TABLE_TYPES]
    out["notes"] = [note(str(n.get("text") or ""), str(n.get("position") or "auto"), float(_num(n.get("size"), 3.5)),
                         bool(n.get("bold"))) for n in (out.get("notes") or []) if isinstance(n, dict) and n.get("text")]
    return out


def _num(v: Any, default: float) -> float:
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return default


def parse_scale(value: str) -> Optional[float]:
    """'auto' → None; '1:5' → 0.2; '2:1' → 2; '0.2' → 0.2."""
    v = str(value or "auto").strip().lower()
    if v in ("", "auto"):
        return None
    if ":" in v:
        a, b = v.split(":", 1)
        try:
            return float(a.replace(",", ".")) / float(b.replace(",", "."))
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(v.replace(",", "."))
    except ValueError:
        return None


def parse_position(value: str) -> Optional[tuple]:
    v = str(value or "auto").strip().lower()
    if v in ("", "auto"):
        return None
    parts = v.replace(";", ",").split(",")
    if len(parts) != 2:
        return None
    try:
        return (float(parts[0]), float(parts[1]))
    except ValueError:
        return None


# ----------------------------------------------------------------------
# persistence: per-product overrides survive regeneration
# ----------------------------------------------------------------------
def spec_dir() -> str:
    d = os.path.join(user_data_dir(), "specs")
    os.makedirs(d, exist_ok=True)
    return d


def spec_path(product: str) -> str:
    return os.path.join(spec_dir(), sanitize_filename(product or "product") + ".json")


def load_overrides(product: str) -> Dict[str, Dict[str, Any]]:
    try:
        with open(spec_path(product), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {sh["id"]: sh for sh in data.get("sheets", []) if isinstance(sh, dict) and sh.get("id")}
    except (OSError, ValueError, KeyError):
        return {}


def save_overrides(product: str, overrides: Dict[str, Dict[str, Any]]) -> str:
    path = spec_path(product)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"version": SPEC_VERSION, "sheets": list(overrides.values())}, fh, ensure_ascii=False, indent=1)
    return path


def merge_overrides(spec: Dict[str, Any], overrides: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Replaces default sheets by their saved versions (matched by id)."""
    out = copy.deepcopy(spec)
    for i, sh in enumerate(out["sheets"]):
        ov = overrides.get(sh["id"])
        if ov:
            out["sheets"][i] = normalize_sheet(ov, sh)
    return out


# ----------------------------------------------------------------------
# JSON schema for structured output (no numeric constraints, additionalProperties false)
# ----------------------------------------------------------------------
def _obj(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or list(props.keys()), "additionalProperties": False}


DIM_SCHEMA = _obj({
    "type": {"type": "string", "enum": DIM_TYPES},
    "side": {"type": "string", "enum": ["", "left", "right", "top", "bottom"]},
    "from": {"type": "string"}, "to": {"type": "string"},
    "axis": {"type": "string", "enum": ["x", "y"]},
    "text": {"type": "string"},
})
VIEW_SCHEMA = _obj({
    "id": {"type": "string"},
    "direction": {"type": "string", "enum": DIRECTIONS + ["flat"]},
    "scale": {"type": "string"}, "position": {"type": "string"},
    "style": {"type": "string", "enum": VIEW_STYLES},
    "exploded": {"type": "boolean"}, "explode_scale": {"type": "string"},
    "parts": {"type": "string"},
    "dims": {"type": "array", "items": DIM_SCHEMA},
    "balloons": {"type": "boolean"}, "label": {"type": "string"},
    "hole_symbols": {"type": "boolean"},
    "hole_strategy": {"type": "string", "enum": HOLE_STRATEGIES},
    "hole_notes": {"type": "boolean"},
})
TABLE_SCHEMA = _obj({
    "type": {"type": "string", "enum": TABLE_TYPES},
    "position": {"type": "string", "enum": TABLE_POSITIONS},
    "title": {"type": "string"},
    "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
    "columns": {"type": "array", "items": {"type": "string"}},
})
NOTE_SCHEMA = _obj({"text": {"type": "string"}, "position": {"type": "string"}, "size": {"type": "string"},
                    "bold": {"type": "boolean"}})
SHEET_SCHEMA = _obj({
    "id": {"type": "string"},
    "kind": {"type": "string", "enum": KINDS},
    "title": {"type": "string"}, "subject": {"type": "string"},
    "size": {"type": "string", "enum": SIZES},
    "orientation": {"type": "string", "enum": ["Landscape", "Portrait"]},
    "first_angle": {"type": "boolean"},
    "header": {"type": "string"}, "material": {"type": "string"},
    "views": {"type": "array", "items": VIEW_SCHEMA},
    "tables": {"type": "array", "items": TABLE_SCHEMA},
    "notes": {"type": "array", "items": NOTE_SCHEMA},
})
AI_RESPONSE_SCHEMA = _obj({
    "explanation": {"type": "string"},
    "sheet": SHEET_SCHEMA,
})

SPEC_DOC = """Формат листа (JSON):
- kind: СБ | ВЗР | ДЕТ; subject: assembly | assembly:<occ_id> | part:<key> | flat:<key> (не менять).
- size A4..A0 (ISO) или A..E (ASME); orientation Landscape|Portrait; first_angle true = ISO (вид сверху под главным,
  вид слева справа), false = ASME (вид сверху над главным, вид справа справа).
- views[]: direction front|back|left|right|top|bottom|iso|iso_left|iso_back|iso_back_left|iso_bottom|flat;
  scale "auto" или "1:5"/"2:1"; position "auto" или "x,y" (мм, левый нижний угол вида, начало координат — левый
  нижний угол листа); style outline|hidden|shaded; exploded true — разнесённый вид (explode_scale множитель
  смещений); parts "all" или список occ_id через запятую; balloons — позиционные выноски; label — подпись над видом;
  hole_symbols — отверстия (кружки/пунктир) для одной детали; hole_strategy Chain|Baseline|Overall; hole_notes — список отверстий.
- dims[]: overall_w (side "" | bottom | top), overall_h (side "" | left | right), thickness, holes_x, holes_y,
  linear (from/to — occ_id детали или "hole:N", axis x|y).
- tables[]: type spec|hardware|bends|custom (custom: columns + rows), position right|left|bottom_left|bottom_right|top_left|top_right.
- notes[]: text, position "x,y" мм или auto, size мм, bold.
Главный вид смотрит на «перёд» изделия (или на пласть панели у детали), ось X листа — вправо, Y — вверх."""
