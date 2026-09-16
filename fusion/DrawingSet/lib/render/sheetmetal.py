"""Flat pattern sheet for sheet metal parts: outline, bend lines, overall dims, bend table."""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from ..bom import BEND_HEADER, BendRow, SpecRow, bend_rows, fmt_mm
from ..geom import make_view, standard_views
from ..scene import FlatPatternGeom, PartGeom
from . import dims
from .layout import GAP, Region, Sheet, fit_scale, new_sheet, place, scale_text
from .prims import FONT_SIZE, Polyline, Text, W_THIN
from .tables import draw_table
from .views import ViewStyle, render_parts

BEND_COLUMNS = [("№", 10.0, "middle"), ("Угол", 16.0, "middle"), ("Напр.", 16.0, "middle"),
                ("R, мм", 16.0, "middle"), ("K", 14.0, "middle")]


def flat_pattern_sheet(part: Optional[PartGeom], flat: FlatPatternGeom, row: SpecRow, bends: Sequence[BendRow], *,
                       size: str, orientation: str, meta: Dict[str, str], bend_table: bool = True,
                       style: Optional[ViewStyle] = None) -> Sheet:
    view = make_view((0.0, 0.0, -1.0), (0.0, 1.0, 0.0), "flat")
    flat_part = PartGeom(id=row.occ_ids[0] if row.occ_ids else "flat", bodies=[flat.body])
    image = render_parts([flat_part], view, style=style)
    sheet, region = new_sheet(size, orientation, meta)
    table_w = sum(c[1] for c in BEND_COLUMNS) + 6 if bend_table and bends else 0.0
    area = Region(region.x + 20, region.y + 20, region.w - table_w - 60, region.h - 40)
    s = fit_scale([image], [image.width], [image.height], area, GAP, 1.0)
    placed = place(sheet, image, s, area.x + GAP, area.y + GAP)
    sheet.meta["scale"] = scale_text(s)
    for p in sheet.prims:
        if isinstance(p, Text) and p.text == meta.get("scale", "—"):
            p.text = scale_text(s)
    for line in flat.bend_lines:
        pts = [placed.to_sheet(view.project2(p)) for p in line]
        if len(pts) >= 2:
            sheet.add(Polyline(pts, width=W_THIN, dash="center", layer="BEND"))
    x0, y0, x1, y1 = placed.bbox()
    sheet.extend(dims.linear_h(x0, x1, y0, y0 - 9, value=image.width))
    sheet.extend(dims.linear_v(y0, y1, x1, x1 + 9, value=image.height))
    title = f"Поз. {row.position}  {row.title} — развёртка" if row.position else f"{row.title} — развёртка"
    sheet.add(Text(region.x, region.y1 - 5, title, 5.0, "start", bold=True))
    info = "  ·  ".join(t for t in (row.material, f"толщина {fmt_mm(flat.thickness or row.thickness_mm)} мм",
                                   f"{row.quantity} шт.") if t)
    sheet.add(Text(region.x, region.y1 - 11.5, info, FONT_SIZE, "start"))
    if bend_table and bends:
        rows = [[str(b.index), fmt_mm(b.angle_deg, 1), b.direction, fmt_mm(b.radius_mm, 2), fmt_mm(b.k_factor, 3)]
                for b in bends]
        prims, _ = draw_table(region.x1 - table_w + 6, region.y1 - 16, BEND_COLUMNS, rows, 6.5, title="Гибы")
        sheet.extend(prims)
    return sheet
