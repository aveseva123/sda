"""Balloon (position callout) placement around a view, in sheet coordinates."""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

from .prims import Circle, FONT_SIZE, Line, Primitive, Text, W_THIN

Pt = Tuple[float, float]
BBox = Tuple[float, float, float, float]


def place_balloons(anchors: Dict[str, Pt], labels: Dict[str, str], bbox: BBox, radius: float = 4.0,
                   margin: float = 14.0, size: float = FONT_SIZE) -> List[Primitive]:
    """Distributes balloons on the four sides of the view bounding box and draws leaders."""
    if not anchors:
        return []
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(x1 - x0, 1e-6), max(y1 - y0, 1e-6)
    sides: Dict[str, List[Tuple[float, str]]] = {"left": [], "right": [], "top": [], "bottom": []}
    for pid, (ax, ay) in anchors.items():
        if pid not in labels:
            continue
        nx, ny = (ax - cx) / w, (ay - cy) / h
        if abs(nx) >= abs(ny):
            sides["right" if nx >= 0 else "left"].append((ay, pid))
        else:
            sides["top" if ny >= 0 else "bottom"].append((ax, pid))
    prims: List[Primitive] = []
    step = 2.6 * radius

    def spread(values: List[float], lo: float, hi: float) -> List[float]:
        """Keeps the order, enforces min spacing, stays within [lo, hi] when possible."""
        if not values:
            return []
        out = [values[0]]
        for v in values[1:]:
            out.append(max(v, out[-1] + step))
        overflow = out[-1] - hi
        if overflow > 0:
            out = [v - overflow for v in out]
        if out[0] < lo:
            shift = lo - out[0]
            out = [v + shift for v in out]
        return out

    for side, items in sides.items():
        if not items:
            continue
        items.sort()
        coords = spread([v for v, _ in items], (y0 if side in ("left", "right") else x0),
                        (y1 if side in ("left", "right") else x1))
        for (v, pid), c in zip(items, coords):
            if side == "left":
                bx, by = x0 - margin, c
            elif side == "right":
                bx, by = x1 + margin, c
            elif side == "top":
                bx, by = c, y1 + margin
            else:
                bx, by = c, y0 - margin
            ax, ay = anchors[pid]
            dx, dy = ax - bx, ay - by
            n = math.hypot(dx, dy) or 1.0
            sx, sy = bx + dx / n * radius, by + dy / n * radius
            prims.append(Line(sx, sy, ax, ay, W_THIN, layer="DIM"))
            prims.append(Circle(ax, ay, 0.6, fill="#000000", layer="DIM"))
            prims.append(Circle(bx, by, radius, W_THIN, fill="#ffffff", layer="DIM"))
            prims.append(Text(bx, by, labels[pid], size, "middle", valign="middle", layer="DIM"))
    return prims
