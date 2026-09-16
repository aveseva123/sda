"""Reads the furniture model: parts, materials, sizes, hardware, sheet metal, section markers.

The module only uses duck-typed access to Fusion objects so that the traversal can be
tested with a fake occurrence tree (see tests/test_model.py). All internal Fusion
lengths are centimetres; everything stored here is millimetres.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .bom import BendRow, PartRecord, description_text
from .config import Settings
from .explode import ExplodeItem, Vec
from .naming import classify, is_hardware_name, parse_name, strip_instance_suffix, strip_version_suffix

CM = 10.0  # cm -> mm


@dataclass
class SheetMetalPart:
    title: str
    position: str
    component: Any            # adsk.fusion.Component
    flat_pattern: Any = None  # adsk.fusion.FlatPattern or None


@dataclass
class ModelData:
    product: str = ""
    project: str = ""
    view: str = ""
    parts: List[PartRecord] = field(default_factory=list)
    explode_items: List[ExplodeItem] = field(default_factory=list)
    section_markers: List[str] = field(default_factory=list)
    bends: List[BendRow] = field(default_factory=list)
    sheet_metal: List[SheetMetalPart] = field(default_factory=list)
    occurrences: Dict[str, Any] = field(default_factory=dict)   # occ_id -> Occurrence
    warnings: List[str] = field(default_factory=list)
    has_subassemblies: bool = False

    def part_by_id(self, occ_id: str) -> Optional[PartRecord]:
        for p in self.parts:
            if p.occ_id == occ_id:
                return p
        return None


# ----------------------------------------------------------------------
def _vec(v: Any) -> Vec:
    return (float(v.x), float(v.y), float(v.z))


def _obb(entity: Any) -> Optional[Tuple[Vec, Tuple[Vec, Vec, Vec], Tuple[float, float, float]]]:
    """Returns (center_mm, axes, dims_mm) of an oriented minimum bounding box, or None."""
    try:
        box = entity.orientedMinimumBoundingBox
    except Exception:
        return None
    if box is None:
        return None
    try:
        center = tuple(c * CM for c in _vec(box.centerPoint))
        axes = (_vec(box.lengthDirection), _vec(box.widthDirection), _vec(box.heightDirection))
        dims = (float(box.length) * CM, float(box.width) * CM, float(box.height) * CM)
    except Exception:
        return None
    return center, axes, dims  # type: ignore[return-value]


def _aabb_fallback(entity: Any) -> Optional[Tuple[Vec, Tuple[Vec, Vec, Vec], Tuple[float, float, float]]]:
    try:
        bb = entity.boundingBox
        mn, mx = _vec(bb.minPoint), _vec(bb.maxPoint)
    except Exception:
        return None
    center = tuple((a + b) / 2 * CM for a, b in zip(mn, mx))
    dims = tuple((b - a) * CM for a, b in zip(mn, mx))
    return center, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), dims  # type: ignore[return-value]


def _material_name(bodies: List[Any], component: Any) -> str:
    for b in bodies:
        try:
            m = b.material
            if m is not None and m.name:
                return str(m.name)
        except Exception:
            continue
    try:
        m = component.material
        if m is not None and m.name:
            return str(m.name)
    except Exception:
        pass
    return ""


def _attribute(entity: Any, group: str, name: str) -> str:
    try:
        attr = entity.attributes.itemByName(group, name)
        if attr is not None and attr.value:
            return str(attr.value)
    except Exception:
        pass
    return ""


def _edge_banding(component: Any, bodies: List[Any], raw_name: str, settings: Settings) -> str:
    if settings.edge_attr_group and settings.edge_attr_name:
        val = _attribute(component, settings.edge_attr_group, settings.edge_attr_name)
        if not val:
            for b in bodies:
                val = _attribute(b, settings.edge_attr_group, settings.edge_attr_name)
                if val:
                    break
        if val:
            return val
    if settings.edge_regex:
        try:
            m = re.search(settings.edge_regex, raw_name)
            if m and m.groupdict().get("edge"):
                return m.group("edge")
        except re.error:
            pass
    return ""


def _count_holes(bodies: List[Any]) -> int:
    count = 0
    for b in bodies:
        try:
            for face in b.faces:
                geom = face.geometry
                if "Cylinder" in str(getattr(geom, "objectType", "")):
                    radius = float(getattr(geom, "radius", 0.0)) * CM
                    if 0 < radius <= 20.0:
                        count += 1
        except Exception:
            continue
    return count


def _solid_bodies(occ: Any) -> List[Any]:
    out = []
    try:
        for b in occ.bRepBodies:
            try:
                if b.isSolid and b.isVisible:
                    out.append(b)
            except Exception:
                out.append(b)
    except Exception:
        pass
    return out


# ----------------------------------------------------------------------
def collect(root_component: Any, settings: Settings, log=None, product_name: str = "") -> ModelData:
    """Walks the occurrence tree of the root component and fills a ModelData."""
    data = ModelData(product=strip_version_suffix(strip_instance_suffix(product_name or getattr(root_component, "name", ""))))
    hardware_kw = settings.hardware_keywords

    def walk(parent_occ: Any, parent_id: Optional[str], level: int) -> None:
        try:
            occs = parent_occ.childOccurrences if parent_id is not None else parent_occ.occurrences
        except Exception:
            return
        for occ in occs:
            try:
                if not occ.isLightBulbOn:
                    continue
            except Exception:
                pass
            comp = occ.component
            occ_id = str(getattr(occ, "fullPathName", None) or getattr(occ, "name", "") or id(occ))
            raw_name = strip_instance_suffix(getattr(comp, "name", "") or getattr(occ, "name", ""))
            parsed = parse_name(raw_name, settings.name_regex)
            try:
                children = list(occ.childOccurrences)
            except Exception:
                children = []
            children = [c for c in children if getattr(c, "isLightBulbOn", True)]
            bodies = _solid_bodies(occ)
            data.occurrences[occ_id] = occ

            if children:
                data.has_subassemblies = True
                geo = _obb(occ) or _aabb_fallback(occ)
                if geo:
                    center, axes, dims = geo
                    data.explode_items.append(ExplodeItem(
                        id=occ_id, center=center, axes=axes, dims=dims, category="assembly",
                        parent=parent_id, children=[]))
                data.parts.append(PartRecord(
                    occ_id=occ_id, component_id=str(getattr(comp, "id", raw_name)), raw_name=raw_name,
                    title=parsed.title, position=parsed.display_position, project=parsed.project,
                    view=parsed.view, category="assembly", level=level, parent_id=parent_id))
                if bodies and log:
                    log.warn(f"«{raw_name}»: подсборка содержит собственные тела — они не попадут в спецификацию.")
                walk(occ, occ_id, level + 1)
                if data.explode_items and data.explode_items[-1].id != occ_id:
                    for it in data.explode_items:
                        if it.id == occ_id:
                            it.children = [c.id for c in data.explode_items if c.parent == occ_id]
                continue

            if not bodies:
                if log:
                    log.warn(f"«{raw_name}»: нет видимых твёрдых тел, компонент пропущен.")
                continue

            geo = None
            if len(bodies) == 1:
                geo = _obb(bodies[0])
            geo = geo or _obb(occ) or _aabb_fallback(occ)
            if not geo:
                if log:
                    log.warn(f"«{raw_name}»: не удалось получить габаритный бокс, компонент пропущен.")
                continue
            center, axes, dims = geo
            sorted_dims = sorted(dims, reverse=True)
            length_mm, width_mm, thickness_mm = sorted_dims
            material = _material_name(bodies, comp)
            is_sheet_metal = any(bool(getattr(b, "isSheetMetal", False)) for b in bodies)
            panel_like = thickness_mm <= settings.panel_max_thickness_mm and length_mm >= 3 * thickness_mm
            small_chunky = (length_mm <= settings.hardware_max_size_mm and thickness_mm > 0
                            and thickness_mm / max(length_mm, 1e-6) > 0.15)
            hardware = is_hardware_name(parsed.title, hardware_kw) or (
                not is_sheet_metal and not panel_like and small_chunky)
            if hardware:
                category = "hardware"
            elif panel_like:
                category = classify(parsed.title, settings.category_keywords)
            else:
                category = "other"
            edge = _edge_banding(comp, bodies, raw_name, settings) if settings.det_edge_banding else ""

            rec = PartRecord(
                occ_id=occ_id, component_id=str(getattr(comp, "id", raw_name)), raw_name=raw_name,
                title=parsed.title, position=parsed.display_position, project=parsed.project, view=parsed.view,
                material=material, thickness_mm=round(thickness_mm, 2), length_mm=round(length_mm, 1),
                width_mm=round(width_mm, 1), category=category, is_sheet_metal=is_sheet_metal, edge=edge,
                hole_count=_count_holes(bodies) if not hardware else 0, level=level, parent_id=parent_id,
                is_hardware=hardware)
            if not parsed.matched and log:
                log.warn(f"«{raw_name}»: имя не по шаблону, позиция «{parsed.display_position or '—'}».")
            data.parts.append(rec)
            data.explode_items.append(ExplodeItem(
                id=occ_id, center=center, axes=axes, dims=dims, category=category, parent=parent_id,
                is_hardware=hardware))
            if is_sheet_metal:
                data.sheet_metal.append(SheetMetalPart(parsed.title, parsed.display_position, comp))

    walk(root_component, None, 1)

    # project / view: most common values among the parts
    projects = Counter(p.project for p in data.parts if p.project)
    views = Counter(p.view for p in data.parts if p.view)
    data.project = settings.project_override or (projects.most_common(1)[0][0] if projects else "")
    data.view = views.most_common(1)[0][0] if views else ""
    if settings.product_override:
        data.product = settings.product_override

    data.section_markers = find_section_markers(root_component, settings.section_marker_prefix)

    # duplicate position check (same position, different geometry)
    by_pos: Dict[str, set] = {}
    for p in data.parts:
        if p.position and p.category != "assembly":
            by_pos.setdefault(p.position, set()).add((p.title.lower(), round(p.length_mm), round(p.width_mm), round(p.thickness_mm, 1)))
    for pos, variants in by_pos.items():
        if len(variants) > 1:
            msg = f"Позиция {pos} присвоена разным деталям: {sorted(variants)}"
            data.warnings.append(msg)
            if log:
                log.warn(msg)
    return data


def find_section_markers(root_component: Any, prefix: str) -> List[str]:
    """Names of construction planes / sketches whose name starts with the prefix (any component)."""
    if not prefix:
        return []
    found: List[str] = []
    comps: List[Any] = [root_component]
    try:
        design = root_component.parentDesign
        comps = list(design.allComponents)
    except Exception:
        pass
    low = prefix.lower()
    for comp in comps:
        for coll_name in ("constructionPlanes", "sketches"):
            try:
                coll = getattr(comp, coll_name)
                for item in coll:
                    name = str(getattr(item, "name", ""))
                    if name.lower().startswith(low):
                        found.append(f"{getattr(comp, 'name', '')}: {name}")
            except Exception:
                continue
    return found


# ----------------------------------------------------------------------
def write_component_properties(data: ModelData, log=None) -> int:
    """Writes partNumber (= position) and description into the components of the parts."""
    changed = 0
    seen = set()
    for p in data.parts:
        if p.category == "assembly" or p.component_id in seen:
            continue
        seen.add(p.component_id)
        occ = data.occurrences.get(p.occ_id)
        if occ is None:
            continue
        try:
            comp = occ.component
            desc = description_text(p)
            if p.position and comp.partNumber != p.position:
                comp.partNumber = p.position
                changed += 1
            if desc and comp.description != desc:
                comp.description = desc
                changed += 1
        except Exception as exc:
            if log:
                log.warn(f"«{p.raw_name}»: не удалось записать partNumber/description: {exc}")
    return changed


# ----------------------------------------------------------------------
def prepare_sheet_metal(data: ModelData, settings: Settings, log=None) -> None:
    """Creates missing flat patterns and collects bend tables for sheet metal parts."""
    seen = set()
    for sm in data.sheet_metal:
        comp = sm.component
        key = getattr(comp, "id", id(comp))
        if key in seen:
            continue
        seen.add(key)
        fp = None
        try:
            fp = comp.flatPattern
        except Exception:
            fp = None
        if fp is None and settings.sheet_metal_flat:
            face = _largest_planar_face(comp)
            if face is not None:
                try:
                    fp = comp.createFlatPattern(face)
                    if log:
                        log.info(f"«{sm.title}»: создана развёртка.")
                except Exception as exc:
                    if log:
                        log.warn(f"«{sm.title}»: не удалось создать развёртку: {exc}")
        sm.flat_pattern = fp
        if fp is not None and settings.sheet_metal_bend_table:
            data.bends.extend(_bend_rows(sm, fp, comp, log))


def _largest_planar_face(comp: Any):
    best, best_area = None, -1.0
    try:
        for body in comp.bRepBodies:
            if not getattr(body, "isSheetMetal", False):
                continue
            for face in body.faces:
                if "Plane" not in str(getattr(face.geometry, "objectType", "")):
                    continue
                area = float(getattr(face, "area", 0.0))
                if area > best_area:
                    best, best_area = face, area
    except Exception:
        return best
    return best


def _bend_rows(sm: SheetMetalPart, fp: Any, comp: Any, log=None) -> List[BendRow]:
    rows: List[BendRow] = []
    radius_mm = k_factor = thickness_mm = 0.0
    try:
        rule = comp.activeSheetMetalRule
        radius_mm = float(rule.bendRadius.value) * CM
        k_factor = float(rule.kFactor)
        thickness_mm = float(rule.thickness.value) * CM
    except Exception:
        pass
    try:
        edges = list(fp.bendLinesBody.edges)
    except Exception as exc:
        if log:
            log.warn(f"«{sm.title}»: нет линий гиба в развёртке: {exc}")
        return rows
    for i, edge in enumerate(edges, start=1):
        try:
            ok, is_up, angle = fp.getBendInfo(edge)
        except Exception:
            continue
        if not ok:
            continue
        angle_deg = math.degrees(float(angle)) if abs(float(angle)) <= 2 * math.pi + 1e-6 else float(angle)
        name = f"{sm.position} {sm.title}".strip()
        rows.append(BendRow(name, i, round(angle_deg, 1), "вверх" if is_up else "вниз", radius_mm, k_factor,
                            thickness_mm))
    return rows
