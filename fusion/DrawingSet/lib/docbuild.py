"""Builds the whole drawing set (list of sheets) from model data + scene, and exports it.

Pure module: the Fusion-specific part is only the extraction of the Scene (lib.extract).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from . import bom
from .config import Settings
from .explode import ExplodeResult
from .geom import axis_name, is_circle_2d, standard_views, unit
from .model import ModelData
from .naming import build_file_name, sanitize_filename
from .render import details
from .render.dxf import prims_to_dxf, write_dxf
from .render.generic import RenderContext, render_sheet_spec
from .spec import default_spec, merge_overrides
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
    spec: Dict[str, Any] = field(default_factory=dict)      # the specification the sheets were rendered from

    def by_kind(self, kind: str) -> List[Sheet]:
        return [s for s in self.sheets if s.meta.get("kind") == kind]

    def kinds(self) -> List[str]:
        out: List[str] = []
        for s in self.sheets:
            k = s.meta.get("kind", "")
            if k not in out:
                out.append(k)
        return out

    def sheet_spec(self, spec_id: str) -> Optional[Dict[str, Any]]:
        return next((sh for sh in self.spec.get("sheets", []) if sh.get("id") == spec_id), None)

    def index_of(self, spec_id: str) -> int:
        return next((i for i, s in enumerate(self.sheets) if s.meta.get("spec_id") == spec_id), -1)


def make_context(data: ModelData, scene: Scene, settings: Settings, explode: Optional[ExplodeResult],
                 rows: Sequence[bom.SpecRow]) -> RenderContext:
    up = axis_name(settings.up_axis)
    front = explode.front if (explode is not None and explode.front != (0.0, 0.0, 0.0)) else axis_name(settings.front_axis)
    return RenderContext(data=data, scene=scene, rows=rows, settings=settings, explode=explode, up=up, front=front)


def build_document(data: ModelData, scene: Scene, settings: Settings, explode: Optional[ExplodeResult],
                   rows: Optional[Sequence[bom.SpecRow]] = None,
                   overrides: Optional[Dict[str, Dict[str, Any]]] = None) -> Document:
    """Renders the whole set: default spec (from settings) + saved per-sheet overrides."""
    rows = list(rows) if rows is not None else bom.group_parts(data.parts)
    doc = Document()
    spec = default_spec(data, rows, settings, has_flat=set(scene.flat_patterns.keys()))
    if overrides:
        spec = merge_overrides(spec, overrides)
    doc.spec = spec
    ctx = make_context(data, scene, settings, explode, rows)
    for sh in spec["sheets"]:
        doc.sheets.append(render_sheet_spec(sh, ctx))
    doc.warnings.extend(ctx.warnings)
    if settings.asm_sections and data.section_markers:
        doc.warnings.append("Разрезы по маркерам не строятся автоматически: " + "; ".join(data.section_markers))
    number_sheets(doc)
    return doc


def rerender_sheet(doc: Document, spec_sheet: Dict[str, Any], data: ModelData, scene: Scene, settings: Settings,
                   explode: Optional[ExplodeResult], rows: Sequence[bom.SpecRow]) -> int:
    """Replaces one sheet (matched by spec id) with a re-render of the given spec. Returns its index."""
    ctx = make_context(data, scene, settings, explode, rows)
    sheet = render_sheet_spec(spec_sheet, ctx)
    doc.warnings = [w for w in doc.warnings if not w.startswith(f"Лист «{spec_sheet.get('title')}»")] + ctx.warnings
    idx = doc.index_of(spec_sheet.get("id", ""))
    for i, sh in enumerate(doc.spec.get("sheets", [])):
        if sh.get("id") == spec_sheet.get("id"):
            doc.spec["sheets"][i] = spec_sheet
    if idx < 0:
        doc.sheets.append(sheet)
        idx = len(doc.sheets) - 1
    else:
        doc.sheets[idx] = sheet
    number_sheets(doc)
    return idx


def number_sheets(doc: Document) -> None:
    from .render.prims import Text
    total = len(doc.sheets)
    for i, s in enumerate(doc.sheets, start=1):
        s.meta["number"] = i
        s.meta["total"] = total
        s.meta["sheet"] = f"{i} / {total}"
        for p in s.prims:
            if isinstance(p, Text) and (p.text == "{sheet}" or (p.text.endswith(f" / {total}") and p.size == 3.5 and "/" in p.text and p.text.split(" / ")[0].isdigit())):
                p.text = s.meta["sheet"]


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
        out.append({"id": s.meta.get("spec_id") or f"sheet{i}", "kind": s.meta.get("kind", ""), "title": s.meta.get("title", ""),
                    "number": s.meta.get("number", i + 1), "total": s.meta.get("total", len(doc.sheets)),
                    "scale": s.meta.get("scale", ""), "svg": sheet_to_svg(s, embed_size=False),
                    "spec": doc.sheet_spec(s.meta.get("spec_id", ""))})
    return out
