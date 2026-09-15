"""Exploded-view geometry for panel furniture. Pure module, millimetres.

Every part is described by its oriented bounding box (centre, three unit axes and
the extents along them). A panel's *normal* is the axis with the smallest extent.
The panel is moved along that normal away from the centre of its parent group.
Facades and the back panel move further, shelves are pulled to the front.
Sub-assemblies move as a whole and, optionally, are exploded internally with a
smaller scale. Hardware is hidden, attached to the nearest panel, or left alone.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

Vec = Tuple[float, float, float]


@dataclass
class ExplodeItem:
    id: str
    center: Vec
    axes: Tuple[Vec, Vec, Vec]      # unit directions of the oriented bounding box
    dims: Tuple[float, float, float]  # extents along the axes, mm
    category: str = "panel"         # panel|facade|back|shelf|top|bottom|side|drawer|hardware|other|assembly
    parent: Optional[str] = None
    is_hardware: bool = False
    children: List[str] = field(default_factory=list)

    @property
    def thickness(self) -> float:
        return min(self.dims)

    def normal(self) -> Vec:
        i = min(range(3), key=lambda k: self.dims[k])
        return _unit(self.axes[i])

    def extent_along(self, direction: Vec) -> float:
        """Half-extent of the box projected on a direction."""
        return 0.5 * sum(abs(_dot(_unit(ax), direction)) * d for ax, d in zip(self.axes, self.dims))


@dataclass
class ExplodeParams:
    factor: float = 3.0
    step_mm: float = 60.0
    facade_mult: float = 2.0
    back_mult: float = 1.5
    shelf_mult: float = 1.0
    stagger: float = 0.35
    sub_scale: float = 0.6
    explode_subassemblies: bool = False
    hardware_mode: str = "hide"     # hide | attach | show
    up: Vec = (0.0, 1.0, 0.0)
    front_fallback: Vec = (0.0, 0.0, -1.0)
    central_ratio: float = 0.12     # |projection| below this fraction of group size = central partition

    def base_offset(self, thickness: float) -> float:
        return max(self.factor * max(thickness, 0.0), self.step_mm)


@dataclass
class ExplodeResult:
    offsets: Dict[str, Vec]          # own offset of each item, world axes, mm (not including ancestors)
    hidden: List[str]                # items to hide (hardware in 'hide' mode)
    front: Vec
    notes: List[str] = field(default_factory=list)

    def world_offset(self, items: Dict[str, ExplodeItem], item_id: str) -> Vec:
        """Cumulative offset: own offset plus the offsets of all ancestors."""
        total = (0.0, 0.0, 0.0)
        cur: Optional[str] = item_id
        while cur is not None:
            total = _add(total, self.offsets.get(cur, (0.0, 0.0, 0.0)))
            cur = items[cur].parent if cur in items else None
        return total


# ----------------------------------------------------------------------
# vector helpers
# ----------------------------------------------------------------------
def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


def _unit(a: Vec) -> Vec:
    n = _norm(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def _horizontal(v: Vec, up: Vec) -> Vec:
    """Removes the vertical component and normalises."""
    up = _unit(up)
    return _unit(_sub(v, _scale(up, _dot(v, up))))


def axis_vector(name: str) -> Vec:
    name = (name or "").strip().upper().replace(" ", "")
    sign = -1.0 if name.startswith("-") else 1.0
    letter = name.lstrip("+-")
    base = {"X": (1.0, 0.0, 0.0), "Y": (0.0, 1.0, 0.0), "Z": (0.0, 0.0, 1.0)}.get(letter, (0.0, 1.0, 0.0))
    return _scale(base, sign)


# ----------------------------------------------------------------------
# core algorithm
# ----------------------------------------------------------------------
def group_center(items: Sequence[ExplodeItem]) -> Vec:
    """Centre of the union of the item bounding spheres (approximation via centres and extents)."""
    if not items:
        return (0.0, 0.0, 0.0)
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for it in items:
        for k in range(3):
            e = it.extent_along(tuple(1.0 if j == k else 0.0 for j in range(3)))
            lo[k] = min(lo[k], it.center[k] - e)
            hi[k] = max(hi[k], it.center[k] + e)
    return tuple((lo[k] + hi[k]) / 2.0 for k in range(3))  # type: ignore[return-value]


def group_size(items: Sequence[ExplodeItem], direction: Vec) -> float:
    if not items:
        return 0.0
    d = _unit(direction)
    proj = [_dot(it.center, d) for it in items]
    ext = [it.extent_along(d) for it in items]
    return (max(p + e for p, e in zip(proj, ext)) - min(p - e for p, e in zip(proj, ext)))


def detect_front(items: Sequence[ExplodeItem], center: Vec, params: ExplodeParams) -> Tuple[Vec, str]:
    """Front = away from the back panel; else the facade normal; else the configured fallback."""
    backs = [it for it in items if it.category == "back" and not it.is_hardware]
    if backs:
        b = max(backs, key=lambda it: it.dims[0] * it.dims[1] * it.dims[2] / max(it.thickness, 1e-6))
        v = _horizontal(_sub(center, b.center), params.up)
        if _norm(v) > 1e-9:
            return v, "по задней стенке"
        n = _horizontal(b.normal(), params.up)
        if _norm(n) > 1e-9:
            return n, "по нормали задней стенки"
    facades = [it for it in items if it.category == "facade" and not it.is_hardware]
    if facades:
        f = facades[0]
        v = _horizontal(_sub(f.center, center), params.up)
        if _norm(v) > 1e-9:
            return v, "по фасаду"
    return _unit(params.front_fallback), "по умолчанию (настройка)"


def _resolve_horizontal_roles(items: Sequence[ExplodeItem], up: Vec) -> Dict[str, str]:
    """Panels with a vertical normal that are the highest / lowest become top / bottom, others shelves."""
    roles: Dict[str, str] = {}
    horiz = [it for it in items if not it.is_hardware and it.category not in ("assembly", "other")
             and abs(_dot(it.normal(), _unit(up))) > 0.85]
    if len(horiz) < 2:
        return roles
    ups = [_dot(it.center, _unit(up)) for it in horiz]
    hi, lo = max(ups), min(ups)
    span = hi - lo
    for it, h in zip(horiz, ups):
        if it.category in ("top", "bottom", "shelf"):
            roles[it.id] = it.category
        elif span > 1e-6 and h >= hi - 0.05 * span:
            roles[it.id] = "top"
        elif span > 1e-6 and h <= lo + 0.05 * span:
            roles[it.id] = "bottom"
        else:
            roles[it.id] = "shelf"
    return roles


def _explode_group(items: Sequence[ExplodeItem], params: ExplodeParams, scale: float,
                   result: ExplodeResult) -> None:
    solid = [it for it in items if not it.is_hardware]
    if not solid:
        return
    center = group_center(solid)
    front, how = detect_front(solid, center, params)
    if result.front == (0.0, 0.0, 0.0):
        result.front = front
        result.notes.append(f"Направление «перёд» определено {how}: {tuple(round(c, 3) for c in front)}")
    roles = _resolve_horizontal_roles(solid, params.up)

    # rank along each move direction for staggering (items further out move a bit more)
    planned: List[Tuple[ExplodeItem, Vec, float]] = []
    for it in solid:
        direction, amount = _plan_item(it, center, front, roles, params, solid)
        planned.append((it, direction, amount))

    if params.stagger > 0:
        groups: Dict[Tuple[int, int, int], List[Tuple[ExplodeItem, float]]] = {}
        for it, d, amount in planned:
            if amount <= 0:
                continue
            key = tuple(int(round(c * 100)) for c in d)  # type: ignore[assignment]
            groups.setdefault(key, []).append((it, _dot(it.center, d)))
        rank_extra: Dict[str, float] = {}
        for key, members in groups.items():
            members.sort(key=lambda m: m[1])
            for rank, (it, _) in enumerate(members):
                rank_extra[it.id] = rank * params.stagger * params.base_offset(it.thickness) * scale
        planned = [(it, d, amount + rank_extra.get(it.id, 0.0)) for it, d, amount in planned]

    for it, d, amount in planned:
        result.offsets[it.id] = _scale(d, amount) if amount > 0 else (0.0, 0.0, 0.0)

    # hardware
    hardware = [it for it in items if it.is_hardware]
    for hw in hardware:
        if params.hardware_mode == "hide":
            result.hidden.append(hw.id)
            result.offsets[hw.id] = (0.0, 0.0, 0.0)
        elif params.hardware_mode == "attach" and solid:
            host = min(solid, key=lambda s: _norm(_sub(s.center, hw.center)))
            result.offsets[hw.id] = result.offsets.get(host.id, (0.0, 0.0, 0.0))
        else:
            result.offsets[hw.id] = (0.0, 0.0, 0.0)


def _plan_item(it: ExplodeItem, center: Vec, front: Vec, roles: Dict[str, str], params: ExplodeParams,
               group: Sequence[ExplodeItem]) -> Tuple[Vec, float]:
    base = params.base_offset(it.thickness)
    cat = roles.get(it.id, it.category)
    to_item = _sub(it.center, center)

    if cat == "assembly" or cat == "other":
        d = _unit(to_item)
        if _norm(d) < 1e-9:
            return (0.0, 0.0, 0.0), 0.0
        return d, base

    if cat == "facade":
        d = front
        return d, base * params.facade_mult
    if cat == "back":
        d = _scale(front, -1.0)
        return d, base * params.back_mult
    if cat == "shelf":
        return front, base * params.shelf_mult
    if cat == "drawer":
        return front, base * params.facade_mult

    n = it.normal()
    proj = _dot(n, to_item)
    if proj < 0:
        n = _scale(n, -1.0)
        proj = -proj
    size = group_size(group, n)
    if size > 0 and proj < params.central_ratio * size:
        # central partition: stays in place
        return n, 0.0
    return n, base


def compute_explode(items: Iterable[ExplodeItem], params: ExplodeParams) -> ExplodeResult:
    """Computes explode offsets for a tree of items (root items have parent=None)."""
    by_id: Dict[str, ExplodeItem] = {it.id: it for it in items}
    result = ExplodeResult(offsets={}, hidden=[], front=(0.0, 0.0, 0.0))

    def children_of(pid: Optional[str]) -> List[ExplodeItem]:
        return [it for it in by_id.values() if it.parent == pid]

    def recurse(pid: Optional[str], scale: float) -> None:
        group = children_of(pid)
        if not group:
            return
        if pid is not None and not params.explode_subassemblies:
            for it in group:
                result.offsets[it.id] = (0.0, 0.0, 0.0)
                if it.is_hardware and params.hardware_mode == "hide":
                    result.hidden.append(it.id)
            return
        scaled = ExplodeParams(**{**params.__dict__, "factor": params.factor * scale,
                                  "step_mm": params.step_mm * scale})
        _explode_group(group, scaled, scale, result)
        for it in group:
            if it.children or it.category == "assembly":
                recurse(it.id, scale * params.sub_scale)

    recurse(None, 1.0)
    return result
