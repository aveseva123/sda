"""Detail sheet for one unique part: main view, two edge views, holes, auto dimensions."""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from ..bom import SpecRow, fmt_mm
from ..geom import View, Vec3, cross, dot, mul, standard_views, sub, unit
from ..scene import Hole, PartGeom
from . import dims
from .layout import GAP, Region, Sheet, fit_scale, new_sheet, place, scale_text, Placed
from .prims import Circle, FONT_SIZE, FONT_SMALL, Polyline, Primitive, Text, W_MEDIUM, W_THIN
from .views import ViewStyle, render_parts

Pt = Tuple[float, float]


def part_views(part: PartGeom, first_angle: bool) -> Dict[str, View]:
    """Main view looks at the panel face; the length axis is horizontal."""
    frame = part.frame
    if frame is None:
        return standard_views((0.0, 1.0, 0.0), (0.0, 0.0, -1.0), first_angle)
    order = sorted(range(3), key=lambda i: -frame.dims[i])
    length_ax, width_ax, thick_ax = (frame.axes[order[0]], frame.axes[order[1]], frame.axes[order[2]])
    # `front` of the part = its thickness normal (towards the viewer), paper-up = width axis
    views = standard_views(width_ax, thick_ax, first_angle)
    # make sure the length axis runs left-to-right
    if dot(views["front"].right, length_ax) < 0:
        views = standard_views(width_ax, mul(thick_ax, -1.0), first_angle)
    return views


def hole_prims_for_view(holes: Sequence[Hole], view: View, placed: Placed) -> List[Primitive]:
    """Explicit hole symbols: circle when the hole axis is parallel to the view, dashed box otherwise."""
    prims: List[Primitive] = []
    s = placed.scale
    for h in holes:
        along = dot(unit(h.axis), view.forward)
        if abs(along) > 0.9:
            cx, cy = placed.to_sheet(view.project2(h.entry))
            visible = along > 0    # axis goes away from the viewer: the entry faces the viewer
            prims.append(Circle(cx, cy, h.radius * s, W_MEDIUM if visible else W_THIN,
                                None if visible else "hidden"))
            if not h.through and visible is False:
                pass
        elif abs(along) < 0.1:
            e = placed.to_sheet(view.project2(h.entry))
            end3 = (h.entry[0] + h.axis[0] * h.depth, h.entry[1] + h.axis[1] * h.depth, h.entry[2] + h.axis[2] * h.depth)
            e2 = placed.to_sheet(view.project2(end3))
            dx, dy = e2[0] - e[0], e2[1] - e[1]
            n = math.hypot(dx, dy) or 1.0
            px, py = -dy / n * h.radius * s, dx / n * h.radius * s
            prims.append(Polyline([(e[0] + px, e[1] + py), (e2[0] + px, e2[1] + py), (e2[0] - px, e2[1] - py),
                                   (e[0] - px, e[1] - py)], closed=True, width=W_THIN, dash="hidden"))
    return prims


def _unique(values: Sequence[float], tol: float = 0.05) -> List[float]:
    out: List[float] = []
    for v in sorted(values):
        if not out or abs(v - out[-1]) > tol:
            out.append(v)
    return out


def hole_dimensions(holes: Sequence[Hole], view: View, placed: Placed, strategy: str,
                    x_row: float, y_col: float, bbox_model: Tuple[float, float, float, float]) -> List[Primitive]:
    """Chain / baseline dimensions of hole centres visible in this view (axis parallel to the view)."""
    centers = [view.project2(h.entry) for h in holes if abs(dot(unit(h.axis), view.forward)) > 0.9]
    if not centers:
        return []
    x0, y0, x1, y1 = bbox_model
    xs = _unique([c[0] for c in centers])
    ys = _unique([c[1] for c in centers])
    prims: List[Primitive] = []
    sx0, sy0 = placed.to_sheet((x0, y0))
    sx1, sy1 = placed.to_sheet((x1, y1))

    def chain_h(points: List[float], y_obj: float, y_dim: float) -> None:
        seq = [x0] + points + [x1]
        for a, b in zip(seq[:-1], seq[1:]):
            if b - a < 0.5:
                continue
            ax, bx = placed.to_sheet((a, 0))[0], placed.to_sheet((b, 0))[0]
            prims.extend(dims.linear_h(ax, bx, y_obj, y_dim, value=b - a, size=FONT_SMALL))

    def chain_v(points: List[float], x_obj: float, x_dim: float) -> None:
        seq = [y0] + points + [y1]
        for a, b in zip(seq[:-1], seq[1:]):
            if b - a < 0.5:
                continue
            ay, by = placed.to_sheet((0, a))[1], placed.to_sheet((0, b))[1]
            prims.extend(dims.linear_v(ay, by, x_obj, x_dim, value=b - a, size=FONT_SMALL))

    def baseline_h(points: List[float], y_obj: float, y_dim: float) -> None:
        for i, x in enumerate(points):
            ax, bx = sx0, placed.to_sheet((x, 0))[0]
            prims.extend(dims.linear_h(ax, bx, y_obj, y_dim - i * 6.0, value=x - x0, size=FONT_SMALL))

    def baseline_v(points: List[float], x_obj: float, x_dim: float) -> None:
        for i, y in enumerate(points):
            ay, by = sy0, placed.to_sheet((0, y))[1]
            prims.extend(dims.linear_v(ay, by, x_obj, x_dim + i * 6.0, value=y - y0, size=FONT_SMALL))

    use_baseline = strategy == "Baseline" and len(xs) <= 5 and len(ys) <= 5
    if strategy == "Overall":
        return prims
    if use_baseline:
        baseline_h(xs, sy0, x_row)
        if sy1 - sy0 > 12:
            baseline_v(ys, sx1, y_col)
    else:
        chain_h(xs, sy0, x_row)
        if sy1 - sy0 > 12:
            chain_v(ys, sx1, y_col)
    return prims


def hole_notes(holes: Sequence[Hole]) -> List[str]:
    groups: Dict[Tuple[float, bool, float], int] = {}
    for h in holes:
        key = (round(h.radius, 2), h.through, 0.0 if h.through else round(h.depth, 1))
        groups[key] = groups.get(key, 0) + 1
    notes = []
    for (r, through, depth), n in sorted(groups.items()):
        notes.append(dims.diameter_text(r, depth, n, through) + ("" if through else "") + (" скв." if through else ""))
    return notes


def detail_sheet(part: PartGeom, row: SpecRow, *, first_angle: bool, size: str, orientation: str,
                 meta: Dict[str, str], strategy: str = "Chain", hole_notes_on: bool = True,
                 show_dims: bool = True, style: Optional[ViewStyle] = None) -> Sheet:
    views = part_views(part, first_angle)
    images = {k: render_parts([part], v, style=style) for k, v in views.items()}
    sheet, region = new_sheet(size, orientation, meta)
    front, top, side = images["front"], images["top"], images["side"]
    holes = [h for b in part.bodies for h in b.holes]

    # space for dimension rows between the views (sheet mm)
    def rows_for(view: View, axis: int) -> int:
        n = len(_unique([view.project2(h.entry)[axis] for h in holes if abs(dot(unit(h.axis), view.forward)) > 0.9]))
        if n == 0 or strategy == "Overall":
            return 0
        return min(5, n) if strategy == "Baseline" and n <= 5 else 1
    rows_x = rows_for(views["front"], 0)
    rows_y = rows_for(views["front"], 1)
    dims_x_space = 8.0 + 6.0 * rows_x + 10.0 if show_dims else 8.0
    dims_y_space = 8.0 + 6.0 * rows_y + 10.0 if show_dims else 8.0

    header_h = 14.0
    area = Region(region.x + 6, region.y + 12, region.w - 44, region.h - header_h - 14)
    cols = [front.width, side.width]
    rows = [top.height, front.height] if first_angle else [front.height, top.height]
    small = max(front.width, front.height) < 120
    gap_x = dims_y_space + 6.0
    gap_y = dims_x_space + 6.0
    avail = Region(area.x, area.y, area.w - gap_x - GAP, area.h - gap_y - GAP)
    s = fit_scale([front, top, side], cols, rows, avail, 0.0, 2.0 if small else 1.0)
    x_front = area.x + GAP * 0.5
    x_side = x_front + front.width * s + gap_x
    if first_angle:
        y_top = area.y + GAP * 0.5
        y_front = y_top + top.height * s + gap_y
    else:
        y_front = area.y + GAP * 0.5
        y_top = y_front + front.height * s + gap_y
    placed = {
        "front": place(sheet, front, s, x_front, y_front),
        "top": place(sheet, top, s, x_front, y_top),
        "side": place(sheet, side, s, x_side, y_front),
    }
    sheet.meta["scale"] = scale_text(s)
    for p in sheet.prims:
        if isinstance(p, Text) and p.text == meta.get("scale", "—"):
            p.text = scale_text(s)

    for key in ("front", "top", "side"):
        sheet.extend(hole_prims_for_view(holes, views[key], placed[key]))

    if show_dims:
        fx0, fy0, fx1, fy1 = placed["front"].bbox()
        tx0, ty0, tx1, ty1 = placed["top"].bbox()
        sx0, sy0, sx1, sy1 = placed["side"].bbox()
        # overall dims: length under the plan/front, width at the left, thickness on the side view
        hole_dim_rows = rows_x
        y_row = fy0 - 8.0
        sheet.extend(hole_dimensions(holes, views["front"], placed["front"], strategy, y_row, fx1 + 8.0, front.bbox))
        y_overall = y_row - 6.0 * hole_dim_rows - 2.0
        sheet.extend(dims.linear_h(fx0, fx1, fy0, y_overall, value=front.width))
        x_overall = fx1 + 8.0 + 6.0 * rows_y + 2.0
        sheet.extend(dims.linear_v(fy0, fy1, fx1, x_overall, value=front.height))
        sheet.extend(dims.linear_h(sx0, sx1, sy1, sy1 + 8.0, value=side.width))
        # positions of edge holes along the edge views
        sheet.extend(hole_dimensions(holes, views["top"], placed["top"], "Chain", ty0 - 8.0, tx1 + 8.0, top.bbox))
        sheet.extend(hole_dimensions(holes, views["side"], placed["side"], "Chain", sy0 - 8.0, sx1 + 8.0, side.bbox))

    # header
    hx, hy = region.x, region.y1 - 5
    title = f"Поз. {row.position}  {row.title}" if row.position else row.title
    sheet.add(Text(hx, hy, title, 5.0, "start", bold=True))
    info = "  ·  ".join(t for t in (row.material, f"{fmt_mm(row.thickness_mm)} мм" if row.thickness_mm else "",
                                   row.size_text(), f"{row.quantity} шт.", row.note) if t)
    sheet.add(Text(hx, hy - 6.5, info, FONT_SIZE, "start"))
    if hole_notes_on and holes:
        notes = hole_notes(holes)
        y = hy - 14.0
        sheet.add(Text(region.x1 - 2, y, "Отверстия:", FONT_SIZE, "end", bold=True))
        for n in notes:
            y -= 5.0
            sheet.add(Text(region.x1 - 2, y, n, FONT_SIZE, "end"))
    return sheet
