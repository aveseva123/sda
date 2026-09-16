"""Projects scene parts into a 2D view with the painter's algorithm (filled faces, far to near)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

from ..geom import Vec3, View, add, bbox2, polygon_area, polygon_centroid
from ..scene import PartGeom
from .prims import Circle, Polygon, Polyline, Primitive, W_THICK

Pt = Tuple[float, float]


@dataclass
class ViewStyle:
    outline: float = W_THICK
    fill: str = "#ffffff"
    curved_edges: bool = True      # draw edges of non-planar faces (silhouettes of cylinders are approximate)
    min_area: float = 0.5          # mm², faces with smaller projected area are treated as edge-on


@dataclass
class ViewImage:
    prims: List[Primitive] = field(default_factory=list)   # projected model coordinates, mm, unscaled
    bbox: Tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    anchors: Dict[str, Pt] = field(default_factory=dict)      # part id -> 2D anchor for balloons
    part_bboxes: Dict[str, Tuple[float, float, float, float]] = field(default_factory=dict)

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]


def render_parts(parts: Iterable[PartGeom], view: View, offsets: Optional[Dict[str, Vec3]] = None,
                 hidden: Optional[Set[str]] = None, style: Optional[ViewStyle] = None) -> ViewImage:
    style = style or ViewStyle()
    offsets = offsets or {}
    hidden = hidden or set()
    items: List[Tuple[float, float, int, Primitive]] = []   # (depth, -area, seq, prim)
    seq = 0
    all_pts: List[Pt] = []
    part_pts: Dict[str, List[Pt]] = {}
    part_weights: Dict[str, List[Tuple[float, Pt]]] = {}

    for part in parts:
        if part.id in hidden:
            continue
        off = offsets.get(part.id, (0.0, 0.0, 0.0))
        pts_here: List[Pt] = []
        weights: List[Tuple[float, Pt]] = []
        for body in part.bodies:
            for face in body.faces:
                if not face.loops or not face.loops[0]:
                    continue
                if face.planar:
                    loops2: List[List[Pt]] = []
                    depths: List[float] = []
                    for loop in face.loops:
                        pl: List[Pt] = []
                        for p in loop:
                            x, y, d = view.project(add(p, off))
                            pl.append((x, y))
                            depths.append(d)
                        loops2.append(pl)
                    area = abs(polygon_area(loops2[0]))
                    pts_here.extend(loops2[0])
                    if area < style.min_area:
                        continue
                    depth = sum(depths) / len(depths)
                    prim = Polygon(loops2, fill=style.fill, stroke=True, width=style.outline)
                    items.append((depth, -area, seq, prim))
                    seq += 1
                    weights.append((area, polygon_centroid(loops2[0])))
                elif style.curved_edges:
                    for loop in face.loops:
                        pl = []
                        depths = []
                        for p in loop:
                            x, y, d = view.project(add(p, off))
                            pl.append((x, y))
                            depths.append(d)
                        if len(pl) < 2:
                            continue
                        pts_here.extend(pl)
                        depth = sum(depths) / len(depths)
                        items.append((depth, 0.0, seq, Polyline(pl, closed=True, width=style.outline)))
                        seq += 1
            for edge in body.edges:
                # edges are only needed for bodies without faces (wire bodies, bend lines)
                if body.faces:
                    continue
                pl = [view.project2(add(p, off)) for p in edge.points]
                if len(pl) >= 2:
                    pts_here.extend(pl)
                    items.append((0.0, 0.0, seq, Polyline(pl, closed=False, width=style.outline)))
                    seq += 1
        if pts_here:
            part_pts[part.id] = pts_here
            part_weights[part.id] = weights
            all_pts.extend(pts_here)

    items.sort(key=lambda t: (t[0], t[1], t[2]))
    image = ViewImage(prims=[it[3] for it in items], bbox=bbox2(all_pts))
    for pid, pts in part_pts.items():
        image.part_bboxes[pid] = bbox2(pts)
        w = part_weights.get(pid) or []
        total = sum(a for a, _ in w)
        if total > 0:
            image.anchors[pid] = (sum(a * c[0] for a, c in w) / total, sum(a * c[1] for a, c in w) / total)
        else:
            bx = image.part_bboxes[pid]
            image.anchors[pid] = ((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2)
    return image


def outline_image(part: PartGeom, view: View, style: Optional[ViewStyle] = None) -> ViewImage:
    """Convenience: a single part rendered alone."""
    return render_parts([part], view, style=style)
