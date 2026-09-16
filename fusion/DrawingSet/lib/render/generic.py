"""Spec-driven sheet renderer: draws a sheet from its JSON specification (lib.spec)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .. import bom
from ..geom import View, Vec3, add, cross, dot, make_view, mul, orthogonalize, unit
from ..scene import FlatPatternGeom, PartGeom, Scene
from ..spec import parse_position, parse_scale, row_key
from . import dims
from .assembly import SPEC_COLUMNS
from .balloons import place_balloons
from .details import hole_dimensions, hole_notes, hole_prims_for_view, part_views
from .explode_sheet import HW_COLUMNS
from .layout import GAP, Placed, Region, Sheet, new_sheet, pick_scale, place, scale_text
from .prims import FONT_SIZE, Polyline, Text, W_THIN
from .sheetmetal import BEND_COLUMNS
from .tables import draw_table
from .views import ViewImage, ViewStyle, render_parts

Pt = Tuple[float, float]
ROW_H = 6.5


@dataclass
class RenderContext:
    data: Any                       # ModelData
    scene: Scene
    rows: Sequence[bom.SpecRow]
    settings: Any
    explode: Any = None             # ExplodeResult or None
    up: Vec3 = (0.0, 1.0, 0.0)
    front: Vec3 = (0.0, 0.0, -1.0)
    warnings: List[str] = field(default_factory=list)


# ----------------------------------------------------------------------
# subjects
# ----------------------------------------------------------------------
@dataclass
class Subject:
    parts: List[PartGeom]
    labels: Dict[str, str]
    hidden: Set[str]
    rows: Sequence[bom.SpecRow]
    single: Optional[PartGeom] = None
    row: Optional[bom.SpecRow] = None
    flat: Optional[FlatPatternGeom] = None
    bends: List[bom.BendRow] = field(default_factory=list)


def resolve_subject(subject: str, ctx: RenderContext) -> Subject:
    data, scene, s = ctx.data, ctx.scene, ctx.settings
    hide_hw = s.hardware_mode == "hide"
    hw_ids = {p.occ_id for p in data.parts if p.is_hardware}

    def labels_for(parts_recs, include_hw: bool) -> Dict[str, str]:
        return {p.occ_id: (p.position or "?") for p in parts_recs
                if p.category != "assembly" and (include_hw or not p.is_hardware)}

    if subject.startswith("assembly"):
        parent = subject.split(":", 1)[1] if ":" in subject else None
        recs = [p for p in data.parts if p.category != "assembly" and (parent is None or p.parent_id == parent)]
        parts = [scene.parts[p.occ_id] for p in recs if p.occ_id in scene.parts]
        rows = ctx.rows if parent is None else bom.group_parts([p for p in data.parts if p.parent_id == parent])
        return Subject(parts, labels_for(recs, not hide_hw), hw_ids if hide_hw else set(), rows)
    if subject.startswith("part:") or subject.startswith("flat:"):
        key = subject.split(":", 1)[1]
        row = next((r for r in ctx.rows if row_key(r) == key), None)
        if row is None:
            ctx.warnings.append(f"Лист {subject}: позиция не найдена.")
            return Subject([], {}, set(), [])
        occ_id = next((o for o in row.occ_ids if o in scene.parts), None)
        part = scene.parts.get(occ_id) if occ_id else None
        flat = None
        bends: List[bom.BendRow] = []
        if subject.startswith("flat:"):
            for cid in row.component_ids:
                flat = scene.flat_patterns.get(cid)
                if flat:
                    break
            name = f"{row.position} {row.title}".strip()
            bends = [b for b in data.bends if b.part == name]
        return Subject([part] if part else [], {}, set(), ctx.rows, single=part, row=row, flat=flat, bends=bends)
    ctx.warnings.append(f"Неизвестный subject «{subject}».")
    return Subject([], {}, set(), [])


# ----------------------------------------------------------------------
# view directions
# ----------------------------------------------------------------------
def direction_view(direction: str, front: Vec3, up: Vec3, first_angle: bool) -> View:
    front = orthogonalize(front, up)
    up = unit(up)
    r = unit(cross(mul(front, -1.0), up))       # right of the front view
    if direction == "front":
        return make_view(mul(front, -1.0), up, "front")
    if direction == "back":
        return make_view(front, up, "back")
    if direction == "left":
        return make_view(r, up, "left")
    if direction == "right":
        return make_view(mul(r, -1.0), up, "right")
    if direction == "top":
        return make_view(mul(up, -1.0), front if first_angle else mul(front, -1.0), "top")
    if direction == "bottom":
        return make_view(up, mul(front, -1.0) if first_angle else front, "bottom")
    if direction == "iso_left":
        return make_view(mul(unit(add(add(front, mul(r, -1.0)), up)), -1.0), up, "iso_left")
    if direction == "iso_back":
        return make_view(mul(unit(add(add(mul(front, -1.0), mul(r, -1.0)), up)), -1.0), up, "iso_back")
    if direction == "iso_back_left":
        return make_view(mul(unit(add(add(mul(front, -1.0), r), up)), -1.0), up, "iso_back_left")
    if direction == "iso_bottom":
        return make_view(mul(unit(add(add(front, r), mul(up, -1.0))), -1.0), up, "iso_bottom")
    return make_view(mul(unit(add(add(front, r), up)), -1.0), up, "iso")


def part_frame(part: PartGeom, first_angle: bool) -> Tuple[Vec3, Vec3]:
    """(front, up) of a single part so that the main view looks at the panel face."""
    views = part_views(part, first_angle)
    f = views["front"]
    return mul(f.forward, -1.0), f.up


def is_iso(direction: str) -> bool:
    return direction.startswith("iso")


# ----------------------------------------------------------------------
# main entry
# ----------------------------------------------------------------------
def render_sheet_spec(sh: Dict[str, Any], ctx: RenderContext) -> Sheet:
    s = ctx.settings
    subj = resolve_subject(sh.get("subject", "assembly"), ctx)
    first_angle = bool(sh.get("first_angle", True))
    meta = {"project": ctx.data.project, "product": ctx.data.product, "view": ctx.data.view, "scale": "—",
            "sheet": "{sheet}", "kind": sh.get("kind", ""), "title": sh.get("title", ""),
            "material": sh.get("material", "")}
    sheet, region = new_sheet(sh.get("size", "A3"), sh.get("orientation", "Landscape"), meta)
    sheet.meta["spec_id"] = sh.get("id", "")

    # header (single part sheets)
    top_used = 0.0
    if sh.get("header") or subj.single is not None or subj.flat is not None:
        title = sh.get("title", "")
        sheet.add(Text(region.x, region.y1 - 5, title, 5.0, "start", bold=True))
        if sh.get("header"):
            sheet.add(Text(region.x, region.y1 - 11.5, sh["header"], FONT_SIZE, "start"))
        top_used = 16.0

    # frame of reference
    if subj.flat is not None:
        front, up = (0.0, 0.0, 1.0), (0.0, 1.0, 0.0)
        parts: List[PartGeom] = [PartGeom(id="flat", bodies=[subj.flat.body])]
    elif subj.single is not None:
        front, up = part_frame(subj.single, first_angle)
        parts = [subj.single]
    else:
        front, up = ctx.front, ctx.up
        parts = subj.parts
    if not parts:
        sheet.add(Text(region.x, region.y1 - top_used - 10, "Нет геометрии для этого листа", FONT_SIZE, "start"))
        ctx.warnings.append(f"Лист «{sh.get('title')}»: нет геометрии.")
        return sheet

    # tables: reserve areas
    tables = sh.get("tables") or []
    area = Region(region.x, region.y, region.w, region.h - top_used)
    reserved: List[Tuple[Dict[str, Any], Region, List, float]] = []   # (spec, region, columns/rows, width)
    iso_floor = area.y
    for t in tables:
        columns, rows_ = table_content(t, subj, ctx)
        if not rows_:
            continue
        width = sum(c[1] for c in columns)
        height = (len(rows_) + 2) * ROW_H
        pos = t.get("position", "right")
        if pos in ("right", "left"):
            col_w = width + 6
            if pos == "right":
                reg = Region(area.x1 - col_w + 6, area.y, width, area.h)
                area = Region(area.x, area.y, area.w - col_w - GAP * 0.5, area.h)
            else:
                reg = Region(area.x, area.y, width, area.h)
                area = Region(area.x + col_w + GAP * 0.5, area.y, area.w - col_w - GAP * 0.5, area.h)
        elif pos == "bottom_left":
            band = min(height + 6, area.h * 0.5)
            reg = Region(area.x, area.y, width, band)
            area = Region(area.x, area.y + band + GAP * 0.5, area.w, area.h - band - GAP * 0.5)
        elif pos == "bottom_right":
            band = min(height + 6, area.h * 0.5)
            reg = Region(area.x1 - width, area.y, width, band)
            iso_floor = max(iso_floor, area.y + band + GAP * 0.5)
        else:  # top_left / top_right: table hangs in the top corner, views keep the full area
            reg = Region(area.x if pos == "top_left" else area.x1 - width, area.y1 - height, width, height)
        reserved.append((t, reg, (columns, rows_), width))

    # hole notes list (top-right, single part)
    holes = [h for b in (subj.single.bodies if subj.single else []) for h in b.holes]
    notes_h = 0.0
    if subj.single is not None and holes and any(v.get("hole_notes") for v in sh.get("views") or []):
        lines = hole_notes(holes)
        y = region.y1 - 6.0
        sheet.add(Text(region.x1 - 2, y, "Отверстия:", FONT_SIZE, "end", bold=True))
        for line in lines:
            y -= 5.0
            sheet.add(Text(region.x1 - 2, y, line, FONT_SIZE, "end"))
        notes_h = 6.0 + 5.0 * len(lines)

    # views: images
    view_specs = [v for v in (sh.get("views") or []) if isinstance(v, dict)]
    images: Dict[str, Tuple[Dict[str, Any], View, ViewImage]] = {}
    for v in view_specs:
        direction = v.get("direction", "front")
        if direction == "flat":
            vw = make_view((0.0, 0.0, -1.0), (0.0, 1.0, 0.0), "flat")
        else:
            vw = direction_view(direction, front, up, first_angle)
        vparts = select_parts(parts, v.get("parts", "all"), ctx)
        offsets = None
        hidden = set(subj.hidden)
        if v.get("exploded") and ctx.explode is not None and subj.single is None:
            k = _num(v.get("explode_scale"), 1.0)
            by_id = {it.id: it for it in ctx.data.explode_items}
            offsets = {p.id: mul(ctx.explode.world_offset(by_id, p.id), k) for p in vparts}
            hidden |= set(ctx.explode.hidden)
        style = ViewStyle(fill="#e8e8e8" if v.get("style") == "shaded" else "#ffffff")
        img = render_parts(vparts, vw, offsets=offsets, hidden=hidden, style=style)
        if img.width <= 0 and img.height <= 0:
            ctx.warnings.append(f"Вид «{v.get('id')}» пуст.")
            continue
        images[v["id"]] = (v, vw, img)

    # layout
    placed = layout_views(sheet, images, area, first_angle, notes_h, subj.single is not None or subj.flat is not None, holes,
                          iso_floor=iso_floor)
    common_scale = next((p.scale for p in placed.values()), 1.0)
    sheet.meta["scale"] = scale_text(common_scale)
    for p in sheet.prims:
        if isinstance(p, Text) and p.text == "—":
            p.text = sheet.meta["scale"]

    # per-view annotations
    for vid, pl in placed.items():
        v, vw, img = images[vid]
        if v.get("label"):
            x0, y0, x1, y1 = pl.bbox()
            top = y1 + 5.0 + (20.0 if v.get("balloons") else 0.0) + (10.0 if any(d.get("type") == "overall_w" and d.get("side") == "top" for d in v.get("dims") or []) else 0.0)
            sheet.add(Text(x0 - (18.0 if v.get("balloons") else 0.0), top, f"{v['label']} {scale_text(pl.scale)}", FONT_SIZE, "start", bold=True))
        if subj.single is not None and v.get("hole_symbols"):
            sheet.extend(hole_prims_for_view(holes, vw, pl))
        if subj.flat is not None and v.get("direction") == "flat":
            for line in subj.flat.bend_lines:
                pts = [pl.to_sheet(vw.project2(p)) for p in line]
                if len(pts) >= 2:
                    sheet.add(Polyline(pts, width=W_THIN, dash="center", layer="BEND"))
        draw_dims(sheet, v, vw, pl, holes, subj, ctx)
        if v.get("balloons") and subj.labels:
            labels = {k: lab for k, lab in subj.labels.items() if k in pl.image.anchors}
            sheet.extend(place_balloons(pl.anchors(), labels, pl.bbox(), margin=12.0))

    # tables
    for t, reg, (columns, rows_), width in reserved:
        prims, _ = draw_table(reg.x, reg.y1 - 2, columns, rows_[: max(int(reg.h / ROW_H) - 2, 1)], ROW_H,
                              title=t.get("title") or "")
        sheet.extend(prims)

    # notes
    ny = region.y1 - top_used - 6.0
    for n in sh.get("notes") or []:
        pos = parse_position(n.get("position", "auto"))
        size = _num(n.get("size"), FONT_SIZE)
        if pos is None:
            pos = (region.x, ny)
            ny -= size * 1.6
        sheet.add(Text(pos[0], pos[1], n.get("text", ""), size, "start", bold=bool(n.get("bold"))))
    return sheet


def _num(v: Any, default: float) -> float:
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return default


def select_parts(parts: Sequence[PartGeom], selector: str, ctx: RenderContext) -> List[PartGeom]:
    sel = (selector or "all").strip()
    if sel.lower() in ("all", "все", ""):
        return list(parts)
    tokens = [t.strip() for t in sel.replace(";", ",").split(",") if t.strip()]
    pos_of = {p.occ_id: p.position for p in ctx.data.parts}
    out = [p for p in parts if p.id in tokens or pos_of.get(p.id, "") in tokens]
    if not out:
        ctx.warnings.append(f"Фильтр деталей «{selector}» ничего не выбрал — показаны все.")
        return list(parts)
    return out


# ----------------------------------------------------------------------
# layout
# ----------------------------------------------------------------------
def view_needs(v: Dict[str, Any], img: ViewImage, rows: int = 1) -> Tuple[float, float, float, float]:
    """Space (left, right, top, bottom) in sheet mm needed around a view for its annotations."""
    left = right = top = bottom = 6.0
    for d in v.get("dims") or []:
        t, side = d.get("type"), d.get("side", "")
        if t == "overall_w":
            if side == "top":
                top = max(top, 16.0)
            else:
                bottom = max(bottom, 16.0 + (6.0 * rows + 2.0 if any(x.get("type") == "holes_x" for x in v.get("dims") or []) else 0.0))
        elif t == "overall_h":
            if side == "right":
                right = max(right, 16.0 + (6.0 * rows + 2.0 if any(x.get("type") == "holes_y" for x in v.get("dims") or []) else 0.0))
            else:
                left = max(left, 16.0)
        elif t == "thickness":
            if img.width <= img.height:
                top = max(top, 14.0)
            else:
                left = max(left, 14.0)
        elif t == "holes_x":
            bottom = max(bottom, 10.0 + 6.0 * rows)
        elif t == "holes_y":
            right = max(right, 10.0 + 6.0 * rows)
        elif t == "linear":
            if d.get("axis", "x") == "x":
                top = max(top, 16.0 + 6.0 * rows)
            else:
                left = max(left, 16.0 + 6.0 * rows)
    if v.get("balloons"):
        left, right, top, bottom = (max(x, 24.0) for x in (left, right, top, bottom))
    if v.get("label"):
        top = max(top, 10.0 + (20.0 if v.get("balloons") else 0.0))
    return left, right, top, bottom


def layout_views(sheet: Sheet, images: Dict[str, Tuple[Dict[str, Any], View, ViewImage]], area: Region,
                 first_angle: bool, notes_h: float, single: bool, holes: Optional[List[Any]] = None,
                 iso_floor: Optional[float] = None) -> Dict[str, Placed]:
    """Auto grid for orthographic views (first/third angle), iso views in a side column, explicit positions honoured."""
    placed: Dict[str, Placed] = {}
    auto = {k: t for k, t in images.items() if parse_position(t[0].get("position", "auto")) is None}
    explicit = {k: t for k, t in images.items() if k not in auto}

    def rows_for(v: Dict[str, Any], vw: View) -> int:
        if not holes or v.get("hole_strategy") != "Baseline":
            return 1
        n = len({round(vw.project2(h.entry)[0], 1) for h in holes if abs(dot(unit(h.axis), vw.forward)) > 0.9})
        return max(1, min(5, n))

    needs = {k: view_needs(t[0], t[2], rows_for(t[0], t[1])) for k, t in images.items()}

    # grid cells around the front view: columns (-1 left slot, 0 front, 1 right slot, 2 back), rows (-1 below, 0, 1 above)
    cells: Dict[Tuple[int, int], str] = {}
    iso_ids: List[str] = []
    front_id = next((k for k, t in auto.items() if t[0]["direction"] in ("front", "flat")), None)
    for k, (v, vw, img) in auto.items():
        d = v["direction"]
        if is_iso(d):
            iso_ids.append(k)
            continue
        if k == front_id or ((0, 0) not in cells and front_id is None):
            cells[(0, 0)] = k
            front_id = k
            continue
        col_row = {
            "top": (0, -1 if first_angle else 1), "bottom": (0, 1 if first_angle else -1),
            "left": (1 if first_angle else -1, 0), "right": (-1 if first_angle else 1, 0), "back": (2, 0),
        }.get(d, (2, 0))
        while col_row in cells:
            col_row = (col_row[0] + 1, col_row[1])
        cells[col_row] = k

    cols = sorted({c for c, _ in cells})
    rws = sorted({r for _, r in cells})
    col_w = {c: max(images[k][2].width for (cc, _), k in cells.items() if cc == c) for c in cols}
    row_h = {r: max(images[k][2].height for (_, rr), k in cells.items() if rr == r) for r in rws}
    col_left = {c: max(needs[k][0] for (cc, _), k in cells.items() if cc == c) for c in cols}
    col_right = {c: max(needs[k][1] for (cc, _), k in cells.items() if cc == c) for c in cols}
    row_top = {r: max(needs[k][2] for (_, rr), k in cells.items() if rr == r) for r in rws}
    row_bottom = {r: max(needs[k][3] for (_, rr), k in cells.items() if rr == r) for r in rws}
    grid_w = sum(col_w.values())
    grid_h = sum(row_h.values())
    margins_w = sum(col_left.values()) + sum(col_right.values())
    margins_h = sum(row_top.values()) + sum(row_bottom.values())
    iso_w = max((images[k][2].width for k in iso_ids), default=0.0)
    iso_h = sum(images[k][2].height + needs[k][2] + needs[k][3] for k in iso_ids)

    from ..geom import STANDARD_SCALES
    avail_h = area.h - notes_h - margins_h
    small = all(max(t[2].width, t[2].height) < 120 for t in auto.values()) if auto else False
    max_scale = 2.0 if small else 1.0
    iso_margin_w = max((needs[k][0] + needs[k][1] for k in iso_ids), default=0.0)
    if cells:
        # largest standard scale where the grid fits and, if iso views exist, leaves room for them at half scale
        common = STANDARD_SCALES[-1]
        for sc in STANDARD_SCALES:
            if sc > max_scale:
                continue
            reserve = (iso_w * sc * 0.5 + iso_margin_w + GAP * 0.5) if iso_ids else 0.0
            if grid_w * sc + margins_w + reserve <= area.w and grid_h * sc <= avail_h:
                common = sc
                break
        iso_col = area.w - (grid_w * common + margins_w) - GAP * 0.5 if iso_ids else 0.0
    else:
        common = 1.0
        iso_col = area.w
    iso_floor = area.y if iso_floor is None else max(iso_floor, area.y)
    iso_avail_h = area.y1 - notes_h - iso_floor
    if iso_ids:
        iso_scale = min(common, pick_scale(iso_w, iso_h, max(iso_col - iso_margin_w, 1.0), iso_avail_h))
    else:
        iso_scale = common
    if not cells:
        common = min(iso_scale, max_scale)

    # place the grid from the bottom-left of the area
    x = area.x
    col_x: Dict[int, float] = {}
    for c in cols:
        x += col_left[c]
        col_x[c] = x
        x += col_w[c] * common + col_right[c]
    y = area.y
    row_y: Dict[int, float] = {}
    for r in rws:
        y += row_bottom[r]
        row_y[r] = y
        y += row_h[r] * common + row_top[r]
    for (c, r), k in cells.items():
        v, vw, img = images[k]
        sc = parse_scale(v.get("scale")) or common
        placed[k] = place(sheet, img, sc, col_x[c], row_y[r])
    # iso column to the right of the grid, stacked from the top
    if iso_ids:
        ix = area.x1 - iso_col + (GAP * 0.5 if cells else 0.0)
        ix = max(ix, x + GAP * 0.5) if cells else area.x + needs[iso_ids[0]][0]
        iy = area.y1 - notes_h
        for k in iso_ids:
            v, vw, img = images[k]
            sc = parse_scale(v.get("scale")) or iso_scale
            width_avail = area.x1 - ix - needs[k][1] - needs[k][0]
            if img.width * sc > width_avail:
                sc = pick_scale(img.width, img.height, width_avail, iso_avail_h)
            iy -= needs[k][2] + img.height * sc
            left = ix + needs[k][0] if cells else ix + (width_avail - img.width * sc) / 2.0
            placed[k] = place(sheet, img, sc, left, max(iy, iso_floor + needs[k][3]))
            iy -= needs[k][3]
    for k, (v, vw, img) in explicit.items():
        sc = parse_scale(v.get("scale")) or common
        pos = parse_position(v.get("position"))
        placed[k] = place(sheet, img, sc, pos[0], pos[1])
    return placed


# ----------------------------------------------------------------------
# dimensions
# ----------------------------------------------------------------------
def draw_dims(sheet: Sheet, v: Dict[str, Any], vw: View, pl: Placed, holes, subj: Subject, ctx: RenderContext) -> None:
    x0, y0, x1, y1 = pl.bbox()
    img = pl.image
    rows_x = 1
    for d in v.get("dims") or []:
        t = d.get("type")
        side = d.get("side", "")
        if t == "overall_w":
            if side == "top":
                sheet.extend(dims.linear_h(x0, x1, y1, y1 + 9.0, value=img.width, text=d.get("text") or None))
            else:
                extra = 6.0 * rows_x + 2.0 if any(x.get("type") == "holes_x" for x in v.get("dims") or []) else 0.0
                sheet.extend(dims.linear_h(x0, x1, y0, y0 - 9.0 - extra, value=img.width, text=d.get("text") or None))
        elif t == "overall_h":
            if side == "right":
                extra = 6.0 * rows_x + 2.0 if any(x.get("type") == "holes_y" for x in v.get("dims") or []) else 0.0
                sheet.extend(dims.linear_v(y0, y1, x1, x1 + 9.0 + extra, value=img.height, text=d.get("text") or None))
            else:
                sheet.extend(dims.linear_v(y0, y1, x0, x0 - 9.0, value=img.height, text=d.get("text") or None))
        elif t == "thickness":
            if img.width <= img.height:
                sheet.extend(dims.linear_h(x0, x1, y1, y1 + 8.0, value=img.width, text=d.get("text") or None))
            else:
                sheet.extend(dims.linear_v(y0, y1, x0, x0 - 8.0, value=img.height, text=d.get("text") or None))
        elif t in ("holes_x", "holes_y") and subj.single is not None:
            strategy = v.get("hole_strategy", "Chain")
            axis = "x" if t == "holes_x" else "y"
            sheet.extend(hole_dimensions(holes, vw, pl, strategy, y0 - 8.0, x1 + 8.0, img.bbox, axes=(axis,)))
            if strategy == "Baseline":
                n = len({round(vw.project2(h.entry)[0 if axis == "x" else 1], 1) for h in holes
                         if abs(dot(unit(h.axis), vw.forward)) > 0.9})
                rows_x = max(rows_x, min(5, n) or 1)
        elif t == "linear":
            a = _anchor(d.get("from", ""), vw, pl, holes, subj)
            b = _anchor(d.get("to", ""), vw, pl, holes, subj)
            if a is None or b is None:
                ctx.warnings.append(f"Размер linear: не найдены точки «{d.get('from')}» / «{d.get('to')}».")
                continue
            if d.get("axis", "x") == "x":
                sheet.extend(dims.linear_h(a[0], b[0], y1, y1 + 9.0 + 6.0 * rows_x, value=abs(b[0] - a[0]) / pl.scale,
                                           text=d.get("text") or None))
            else:
                sheet.extend(dims.linear_v(a[1], b[1], x0, x0 - 9.0 - 6.0 * rows_x, value=abs(b[1] - a[1]) / pl.scale,
                                           text=d.get("text") or None))
            rows_x += 1


def _anchor(ref: str, vw: View, pl: Placed, holes, subj: Subject) -> Optional[Pt]:
    ref = (ref or "").strip()
    if not ref:
        return None
    if ref.startswith("hole:"):
        try:
            idx = int(ref.split(":", 1)[1]) - 1
            h = holes[idx]
            return pl.to_sheet(vw.project2(h.entry))
        except (ValueError, IndexError):
            return None
    if ref in pl.image.anchors:
        return pl.to_sheet(pl.image.anchors[ref])
    for pid, pos in subj.labels.items():
        if pos == ref and pid in pl.image.anchors:
            return pl.to_sheet(pl.image.anchors[pid])
    return None


# ----------------------------------------------------------------------
# tables
# ----------------------------------------------------------------------
def table_content(t: Dict[str, Any], subj: Subject, ctx: RenderContext) -> Tuple[List, List[List[str]]]:
    kind = t.get("type")
    if kind == "spec":
        return SPEC_COLUMNS, bom.spec_rows(subj.rows)
    if kind == "hardware":
        return HW_COLUMNS, bom.hardware_rows(subj.rows)
    if kind == "bends":
        bends = subj.bends or ctx.data.bends
        return BEND_COLUMNS, [[str(b.index), bom.fmt_mm(b.angle_deg, 1), b.direction, bom.fmt_mm(b.radius_mm, 2),
                               bom.fmt_mm(b.k_factor, 3)] for b in bends]
    columns = t.get("columns") or []
    rows_ = t.get("rows") or []
    if not columns and rows_:
        columns = [f"Колонка {i + 1}" for i in range(len(rows_[0]))]
    width = min(180.0, max(40.0, 30.0 * len(columns)))
    cols = [(c, width / max(len(columns), 1), "start") for c in columns]
    return cols, rows_
