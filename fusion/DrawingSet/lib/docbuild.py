"""Builds the whole drawing set (list of sheets) from model data + scene, and exports it.

Pure module: the Fusion-specific part is only the extraction of the Scene (lib.extract).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from . import bom
from .config import Settings
from .explode import ExplodeResult
from .geom import axis_name, is_circle_2d, standard_views, unit
from .model import ModelData
from .naming import build_file_name, sanitize_filename
from .render import assembly, details, explode_sheet, sheetmetal
from .render.dxf import prims_to_dxf, write_dxf
from .render.pdf import write_pdf
from .render.prims import Circle, Polyline, Sheet
from .render.svg import sheet_to_svg
from .render.views import ViewStyle, render_parts
from .scene import PartGeom, Scene

KIND_ASSEMBLY, KIND_EXPLODE, KIND_DETAILS = "СБ", "ВЗР", "ДЕТ"


@dataclass
class Document:
    sheets: List[Sheet] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def by_kind(self, kind: str) -> List[Sheet]:
        return [s for s in self.sheets if s.meta.get("kind") == kind]

    def kinds(self) -> List[str]:
        out: List[str] = []
        for s in self.sheets:
            k = s.meta.get("kind", "")
            if k not in out:
                out.append(k)
        return out


def _labels(data: ModelData, include_hardware: bool) -> Dict[str, str]:
    labels: Dict[str, str] = {}
    for p in data.parts:
        if p.category == "assembly":
            continue
        if p.is_hardware and not include_hardware:
            continue
        labels[p.occ_id] = p.position or "?"
    return labels


def _style(settings: Settings) -> ViewStyle:
    return ViewStyle()


def build_document(data: ModelData, scene: Scene, settings: Settings, explode: Optional[ExplodeResult],
                   rows: Optional[Sequence[bom.SpecRow]] = None) -> Document:
    doc = Document()
    rows = list(rows) if rows is not None else bom.group_parts(data.parts)
    up = axis_name(settings.up_axis)
    front = explode.front if (explode is not None and explode.front != (0.0, 0.0, 0.0)) else axis_name(settings.front_axis)
    first_angle = settings.standard == "ISO"
    size, orient = settings.sheet_size, settings.orientation
    style = _style(settings)
    base_meta = {"project": data.project, "product": data.product, "view": data.view, "scale": "—", "sheet": "{sheet}"}
    hide_hw = settings.hardware_mode == "hide"
    hidden_hw = {p.occ_id for p in data.parts if p.is_hardware} if hide_hw else set()
    parts_all = [scene.parts[p.occ_id] for p in data.parts if p.occ_id in scene.parts and p.category != "assembly"]
    if not parts_all:
        doc.warnings.append("Нет геометрии деталей для построения видов.")
        return doc

    # ---- assembly ----
    if settings.make_assembly:
        labels = _labels(data, include_hardware=not hide_hw)
        meta = {**base_meta, "kind": KIND_ASSEMBLY, "title": f"{data.product} — сборочный чертёж"}
        sheets = assembly.assembly_sheet(
            parts_all, labels if settings.asm_parts_list else {}, rows, up=up, front=front, first_angle=first_angle,
            size=size, orientation=orient, meta=meta, hidden=hidden_hw, show_dims=settings.asm_overall_dims,
            show_balloons=settings.asm_parts_list, show_spec=settings.asm_parts_list, style=style)
        doc.sheets.extend(sheets)
        if settings.asm_subassembly_sheets:
            for asm in [p for p in data.parts if p.category == "assembly"]:
                children = [scene.parts[p.occ_id] for p in data.parts
                            if p.parent_id == asm.occ_id and p.occ_id in scene.parts and p.category != "assembly"]
                if not children:
                    continue
                sub_rows = bom.group_parts([p for p in data.parts if p.parent_id == asm.occ_id])
                meta = {**base_meta, "kind": KIND_ASSEMBLY, "title": f"Подсборка {asm.position} {asm.title}"}
                doc.sheets.extend(assembly.assembly_sheet(
                    children, labels, sub_rows, up=up, front=front, first_angle=first_angle, size=size,
                    orientation=orient, meta=meta, hidden=hidden_hw, show_dims=settings.asm_overall_dims,
                    show_balloons=settings.asm_parts_list, show_spec=settings.asm_parts_list, style=style))
        if settings.asm_sections and data.section_markers:
            doc.warnings.append("Разрезы по маркерам не строятся автоматически: " + "; ".join(data.section_markers))

    # ---- exploded ----
    if settings.make_explode and explode is not None:
        by_id = {it.id: it for it in data.explode_items}
        offsets = {pid: explode.world_offset(by_id, pid) for pid in scene.parts}
        hidden = set(explode.hidden) | (hidden_hw if hide_hw else set())
        labels = _labels(data, include_hardware=settings.hardware_mode == "show")
        meta = {**base_meta, "kind": KIND_EXPLODE, "title": f"{data.product} — схема разнесения"}
        doc.sheets.append(explode_sheet.explode_sheet(
            parts_all, offsets, hidden, labels, rows, up=up, front=front, size=size, orientation=orient, meta=meta,
            hardware_table=settings.hardware_table, style=style))
        if settings.explode_subassemblies:
            for asm in [p for p in data.parts if p.category == "assembly"]:
                children = [scene.parts[p.occ_id] for p in data.parts
                            if p.parent_id == asm.occ_id and p.occ_id in scene.parts and p.category != "assembly"]
                if not children:
                    continue
                own = {c.id: explode.offsets.get(c.id, (0.0, 0.0, 0.0)) for c in children}
                sub_rows = bom.group_parts([p for p in data.parts if p.parent_id == asm.occ_id])
                meta = {**base_meta, "kind": KIND_EXPLODE, "title": f"Подсборка {asm.position} {asm.title} — разнесение"}
                doc.sheets.append(explode_sheet.explode_sheet(
                    children, own, hidden, labels, sub_rows, up=up, front=front, size=size, orientation=orient,
                    meta=meta, hardware_table=settings.hardware_table, style=style))

    # ---- details ----
    if settings.make_details:
        bends_by_part: Dict[str, List[bom.BendRow]] = {}
        for b in data.bends:
            bends_by_part.setdefault(b.part, []).append(b)
        for row in rows:
            if row.is_hardware or not row.occ_ids:
                continue
            occ_id = next((o for o in row.occ_ids if o in scene.parts), None)
            if occ_id is None:
                doc.warnings.append(f"Поз. {row.position} {row.title}: нет геометрии, лист пропущен.")
                continue
            part = scene.parts[occ_id]
            meta = {**base_meta, "kind": KIND_DETAILS, "title": f"Поз. {row.position} {row.title}".strip(),
                    "material": "  ".join(t for t in (row.material, f"{bom.fmt_mm(row.thickness_mm)} мм", row.size_text(),
                                                      f"{row.quantity} шт.") if t)}
            rec = data.part_by_id(occ_id)
            comp_id = rec.component_id if rec else ""
            flat = scene.flat_patterns.get(comp_id) if row.is_sheet_metal else None
            if row.is_sheet_metal and flat is not None and settings.sheet_metal_flat:
                part_bends = bends_by_part.get(f"{row.position} {row.title}".strip(), [])
                doc.sheets.append(sheetmetal.flat_pattern_sheet(
                    part, flat, row, part_bends, size=size, orientation=orient, meta=meta,
                    bend_table=settings.sheet_metal_bend_table, style=style))
                if not settings.sheet_metal_folded:
                    continue
            doc.sheets.append(details.detail_sheet(
                part, row, first_angle=first_angle, size=size, orientation=orient, meta=meta,
                strategy=settings.det_dim_strategy, hole_notes_on=settings.det_hole_notes,
                show_dims=settings.det_auto_dims, style=style))

    # numbering: the title block was drawn with the "{sheet}" placeholder
    from .render.prims import Text
    total = len(doc.sheets)
    for i, s in enumerate(doc.sheets, start=1):
        s.meta["number"] = i
        s.meta["total"] = total
        s.meta["sheet"] = f"{i} / {total}"
        for p in s.prims:
            if isinstance(p, Text) and p.text == "{sheet}":
                p.text = s.meta["sheet"]
    return doc


# ----------------------------------------------------------------------
def part_dxf_prims(part: PartGeom, first_angle: bool = True) -> List:
    """1:1 contour of the main face with holes for CNC / nesting (layers CONTOUR / HOLES / HOLES_BACK)."""
    views = details.part_views(part, first_angle)
    view = views["front"]
    image = render_parts([part], view)
    prims: List = []
    # outer contour: the largest polygon of the main view
    best = None
    best_area = -1.0
    from .geom import polygon_area
    for p in image.prims:
        loops = getattr(p, "loops", None)
        if not loops:
            continue
        a = abs(polygon_area(loops[0]))
        if a > best_area:
            best, best_area = p, a
    if best is not None:
        prims.append(Polyline(list(best.loops[0]), closed=True, layer="CONTOUR"))
        for loop in best.loops[1:]:
            ok, c, r = is_circle_2d(loop)
            if ok:
                prims.append(Circle(c[0], c[1], r, layer="HOLES"))
            else:
                prims.append(Polyline(list(loop), closed=True, layer="HOLES"))
    existing = [(p.cx, p.cy, p.r) for p in prims if isinstance(p, Circle)]
    for body in part.bodies:
        for h in body.holes:
            along = unit(h.axis)
            d = along[0] * view.forward[0] + along[1] * view.forward[1] + along[2] * view.forward[2]
            if abs(d) > 0.9:
                cx, cy = view.project2(h.entry)
                if any(abs(cx - ex) < 0.05 and abs(cy - ey) < 0.05 and abs(h.radius - er) < 0.05 for ex, ey, er in existing):
                    continue
                prims.append(Circle(cx, cy, h.radius, layer="HOLES" if d > 0 else "HOLES_BACK"))
                existing.append((cx, cy, h.radius))
    # normalise to the positive quadrant
    xs = [pt[0] for p in prims for pt in getattr(p, "points", [])] + [p.cx - p.r for p in prims if isinstance(p, Circle)]
    ys = [pt[1] for p in prims for pt in getattr(p, "points", [])] + [p.cy - p.r for p in prims if isinstance(p, Circle)]
    if xs and ys:
        from .render.prims import translate
        prims = translate(prims, -min(xs), -min(ys))
    return prims


def export_document(doc: Document, data: ModelData, scene: Scene, settings: Settings, rows: Sequence[bom.SpecRow],
                    log=None) -> List[str]:
    out_dir = settings.out_dir
    os.makedirs(out_dir, exist_ok=True)
    written: List[str] = []

    def name(kind: str) -> str:
        return build_file_name(settings.file_mask, project=data.project, view=data.view, product=data.product, kind=kind)

    for kind in doc.kinds():
        sheets = doc.by_kind(kind)
        if not sheets:
            continue
        if settings.export_pdf:
            path = os.path.join(out_dir, name(kind) + ".pdf")
            write_pdf(path, sheets)
            written.append(path)
        if settings.export_dxf:
            for i, s in enumerate(sheets, start=1):
                path = os.path.join(out_dir, f"{name(kind)}_л{i:02d}.dxf")
                write_dxf(path, s.prims)
                written.append(path)
        if settings.export_svg:
            for i, s in enumerate(sheets, start=1):
                path = os.path.join(out_dir, f"{name(kind)}_л{i:02d}.svg")
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(sheet_to_svg(s))
                written.append(path)
    if settings.export_summary_pdf and doc.sheets:
        path = os.path.join(out_dir, name("СВОД") + ".pdf")
        write_pdf(path, doc.sheets)
        written.append(path)
    if settings.export_part_dxf:
        # 1:1 part contours for nesting
        for row in rows:
            if row.is_hardware:
                continue
            occ_id = next((o for o in row.occ_ids if o in scene.parts), None)
            if occ_id is None:
                continue
            prims = part_dxf_prims(scene.parts[occ_id], settings.standard == "ISO")
            if not prims:
                continue
            path = os.path.join(out_dir, sanitize_filename(f"{name(KIND_DETAILS)}_{row.position}_{row.title}_1к1") + ".dxf")
            write_dxf(path, prims)
            written.append(path)
    if log:
        for p in written:
            log.info(f"Файл: {p}")
    return written


def sheets_svg(doc: Document) -> List[Dict[str, str]]:
    """Payload for the palette: one SVG per sheet."""
    out = []
    for i, s in enumerate(doc.sheets):
        out.append({"id": f"sheet{i}", "kind": s.meta.get("kind", ""), "title": s.meta.get("title", ""),
                    "number": s.meta.get("number", i + 1), "total": s.meta.get("total", len(doc.sheets)),
                    "scale": s.meta.get("scale", ""), "svg": sheet_to_svg(s, embed_size=False)})
    return out
