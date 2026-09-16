"""Exploded isometric sheet with balloons and the hardware table."""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Set

from ..bom import HARDWARE_HEADER, SpecRow, hardware_rows
from ..geom import Vec3, standard_views
from ..scene import PartGeom
from .balloons import place_balloons
from .layout import GAP, Region, Sheet, fit_scale, new_sheet, place, scale_text
from .prims import FONT_SIZE, Text
from .tables import draw_table
from .views import ViewStyle, render_parts

HW_COLUMNS = [("Поз.", 12.0, "middle"), ("Наименование", 60.0, "start"), ("Кол.", 12.0, "middle"),
              ("Примечание", 40.0, "start")]
HW_WIDTH = sum(c[1] for c in HW_COLUMNS)


def explode_sheet(parts: Sequence[PartGeom], offsets: Dict[str, Vec3], hidden: Set[str], labels: Dict[str, str],
                  rows: Sequence[SpecRow], *, up: Vec3, front: Vec3, size: str, orientation: str,
                  meta: Dict[str, str], hardware_table: bool = True, style: Optional[ViewStyle] = None) -> Sheet:
    iso = standard_views(up, front, True)["iso"]
    image = render_parts(parts, iso, offsets=offsets, hidden=hidden, style=style)
    sheet, region = new_sheet(size, orientation, meta)
    hw = hardware_rows(rows) if hardware_table else []
    right_w = HW_WIDTH + 6 if hw else 0.0
    area = Region(region.x + 16, region.y + 12, region.w - right_w - 32 - (GAP if hw else 0), region.h - 24)
    s = fit_scale([image], [image.width], [image.height], area, GAP, 1.0)
    left = area.x + (area.w - image.width * s) / 2
    bottom = area.y + (area.h - image.height * s) / 2
    placed = place(sheet, image, s, left, bottom)
    sheet.meta["scale"] = scale_text(s)
    for p in sheet.prims:
        if isinstance(p, Text) and p.text == meta.get("scale", "—"):
            p.text = scale_text(s)
    sheet.extend(place_balloons(placed.anchors(), labels, placed.bbox(), margin=12.0))
    sheet.add(Text(region.x, region.y1 - 4, f"Схема разнесения {scale_text(s)}", FONT_SIZE, "start", bold=True))
    if hw:
        prims, _ = draw_table(region.x + region.w - HW_WIDTH, region.y1 - 4, HW_COLUMNS, hw, 6.5, title="Фурнитура")
        sheet.extend(prims)
    return sheet
