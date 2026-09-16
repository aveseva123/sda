"""Assembly sheet: three orthographic views, isometric with balloons, overall dimensions, spec table."""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Set, Tuple

from ..bom import SPEC_HEADER, SpecRow, spec_rows
from ..geom import Vec3, standard_views
from ..scene import PartGeom
from . import dims
from .balloons import place_balloons
from .layout import GAP, Region, Sheet, fit_scale, new_sheet, place, scale_text
from .prims import FONT_SIZE, Text
from .tables import draw_table
from .views import ViewImage, ViewStyle, render_parts

SPEC_COLUMNS = [("Поз.", 11.0, "middle"), ("Наименование", 46.0, "start"), ("Материал", 36.0, "start"),
                ("Толщ.", 12.0, "middle"), ("Размер Д×Ш", 24.0, "middle"), ("Кол.", 10.0, "middle"),
                ("Примечание", 30.0, "start")]
SPEC_WIDTH = sum(c[1] for c in SPEC_COLUMNS)
ROW_H = 6.5


def ortho_layout(images: Dict[str, ViewImage], region: Region, first_angle: bool, max_scale: float = 1.0
                 ) -> Tuple[float, Dict[str, Tuple[float, float]]]:
    """Scale and bottom-left positions (sheet mm) for front / top / side views inside the region."""
    front, top, side = images["front"], images["top"], images["side"]
    cols = [front.width, side.width]
    rows = [top.height, front.height] if first_angle else [front.height, top.height]
    s = fit_scale([front, top, side], cols, rows, region, GAP * 0.75, max_scale)
    x_front = region.x + GAP
    x_side = x_front + front.width * s + GAP
    if first_angle:
        y_top = region.y + GAP
        y_front = y_top + top.height * s + GAP
    else:
        y_front = region.y + GAP
        y_top = y_front + front.height * s + GAP
    return s, {"front": (x_front, y_front), "top": (x_front, y_top), "side": (x_side, y_front)}


def overall_dims(sheet: Sheet, placed_front, placed_top, first_angle: bool) -> None:
    fx0, fy0, fx1, fy1 = placed_front.bbox()
    tx0, ty0, tx1, ty1 = placed_top.bbox()
    w_model = placed_front.image.width
    h_model = placed_front.image.height
    d_model = placed_top.image.height
    sheet.extend(dims.linear_v(fy0, fy1, fx0, fx0 - 9, value=h_model))
    if first_angle:
        # plan below the elevation: width under the plan, depth at its left
        sheet.extend(dims.linear_h(tx0, tx1, ty0, ty0 - 9, value=w_model))
        sheet.extend(dims.linear_v(ty0, ty1, tx0, tx0 - 9, value=d_model))
    else:
        sheet.extend(dims.linear_h(fx0, fx1, fy0, fy0 - 9, value=w_model))
        sheet.extend(dims.linear_v(ty0, ty1, tx0, tx0 - 9, value=d_model))


def assembly_sheet(parts: Sequence[PartGeom], labels: Dict[str, str], rows: Sequence[SpecRow], *,
                   up: Vec3, front: Vec3, first_angle: bool, size: str, orientation: str, meta: Dict[str, str],
                   hidden: Optional[Set[str]] = None, show_dims: bool = True, show_balloons: bool = True,
                   show_spec: bool = True, style: Optional[ViewStyle] = None) -> List[Sheet]:
    """Returns one or more sheets (the spec continues on extra sheets when it does not fit)."""
    views = standard_views(up, front, first_angle)
    images = {k: render_parts(parts, v, hidden=hidden, style=style) for k, v in views.items()}
    sheets: List[Sheet] = []
    sheet, region = new_sheet(size, orientation, meta)
    sheets.append(sheet)

    spec_table_rows = spec_rows(rows) if show_spec else []
    right_w = SPEC_WIDTH + 6 if show_spec else max(60.0, region.w * 0.35)
    left = Region(region.x, region.y, region.w - right_w - GAP, region.h)
    right = Region(region.x + region.w - right_w, region.y, right_w, region.h)

    s, pos = ortho_layout(images, left, first_angle)
    placed = {k: place(sheet, images[k], s, *pos[k]) for k in ("front", "top", "side")}
    sheet.meta["scale"] = scale_text(s)
    # update title block scale text
    for p in sheet.prims:
        if isinstance(p, Text) and p.text == meta.get("scale", "—"):
            p.text = scale_text(s)
    if show_dims:
        overall_dims(sheet, placed["front"], placed["top"], first_angle)

    # isometric in the right column, above the spec
    iso = images["iso"]
    iso_h_avail = right.h * (0.45 if show_spec else 0.9)
    s_iso = min(s, fit_scale([iso], [iso.width], [iso.height], Region(right.x, right.y, right.w, iso_h_avail), GAP, 1.0))
    iso_left = right.x + (right.w - iso.width * s_iso) / 2
    iso_bottom = right.y1 - iso.height * s_iso - GAP
    placed_iso = place(sheet, iso, s_iso, iso_left, iso_bottom)
    sheet.add(Text(right.x, right.y1 - 4, f"Изометрия {scale_text(s_iso)}", FONT_SIZE, "start", bold=True))
    if show_balloons:
        sheet.extend(place_balloons(placed_iso.anchors(), labels, placed_iso.bbox(), margin=12.0))

    if show_spec and spec_table_rows:
        y_top = iso_bottom - GAP - 4
        avail_rows = int((y_top - right.y) / ROW_H) - 2
        first = spec_table_rows[:max(avail_rows, 0)]
        rest = spec_table_rows[max(avail_rows, 0):]
        if first:
            prims, _ = draw_table(right.x, y_top, SPEC_COLUMNS, first, ROW_H, title="Спецификация")
            sheet.extend(prims)
        while rest:
            extra, reg = new_sheet(size, orientation, {**meta, "title": meta.get("title", "") + " (спецификация, продолжение)"})
            n = int(reg.h / ROW_H) - 2
            chunk, rest = rest[:n], rest[n:]
            prims, _ = draw_table(reg.x, reg.y1 - 4, SPEC_COLUMNS, chunk, ROW_H, title="Спецификация (продолжение)")
            extra.extend(prims)
            sheets.append(extra)
    return sheets
