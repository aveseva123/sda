"""Synthetic scene parts (boxes with holes) for tests and offline previews."""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from lib.geom import Vec3, add, cross, mul, unit
from lib.scene import BodyGeom, EdgeGeom, FaceGeom, Hole, LocalFrame, PartGeom

AXES = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _circle(center: Vec3, normal: Vec3, r: float, n: int = 32) -> List[Vec3]:
    nrm = unit(normal)
    ref = (1.0, 0.0, 0.0) if abs(nrm[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = unit(cross(nrm, ref))
    v = cross(nrm, u)
    return [add(center, add(mul(u, r * math.cos(2 * math.pi * i / n)), mul(v, r * math.sin(2 * math.pi * i / n))))
            for i in range(n)]


def box_part(pid: str, center: Vec3, dims: Tuple[float, float, float],
             holes: Sequence[Tuple[str, float, float, float, Optional[float]]] = (),
             axes: Tuple[Vec3, Vec3, Vec3] = AXES) -> PartGeom:
    """Axis-aligned box. dims along axes. holes: (face, u, v, radius, depth|None=through).

    face: '+x' '-x' '+y' '-y' '+z' '-z' — the face the hole enters; (u, v) are offsets from the
    face centre along the two in-plane axes (in the order the remaining axes appear in `axes`).
    """
    ax = axes
    half = [d / 2 for d in dims]
    faces: List[FaceGeom] = []
    body_holes: List[Hole] = []
    face_holes: Dict[str, List[List[Vec3]]] = {}

    def face_normal(name: str) -> Tuple[int, float]:
        idx = "xyz".index(name[1])
        return idx, (1.0 if name[0] == "+" else -1.0)

    for face, u, v, r, depth in holes:
        idx, sgn = face_normal(face)
        others = [i for i in range(3) if i != idx]
        n = mul(ax[idx], sgn)
        c = add(center, add(mul(ax[idx], sgn * half[idx]), add(mul(ax[others[0]], u), mul(ax[others[1]], v))))
        through = depth is None or depth >= dims[idx] - 1e-6
        d = dims[idx] if through else depth
        body_holes.append(Hole(entry=c, axis=mul(n, -1.0), radius=r, depth=d, through=through))
        face_holes.setdefault(face, []).append(_circle(c, n, r))
        bottom = add(c, mul(n, -d))
        if through:
            opposite = ("-" if sgn > 0 else "+") + name_of(idx)
            face_holes.setdefault(opposite, []).append(_circle(bottom, n, r))
        else:
            faces.append(FaceGeom([_circle(bottom, n, r)], mul(n, -1.0), planar=True))
        faces.append(FaceGeom([_circle(c, n, r), _circle(bottom, n, r)], n, planar=False, cylinder_radius=r))

    for idx in range(3):
        for sgn in (1.0, -1.0):
            name = ("+" if sgn > 0 else "-") + name_of(idx)
            others = [i for i in range(3) if i != idx]
            n = mul(ax[idx], sgn)
            fc = add(center, mul(ax[idx], sgn * half[idx]))
            a, b = ax[others[0]], ax[others[1]]
            ha, hb = half[others[0]], half[others[1]]
            outer = [add(fc, add(mul(a, -ha), mul(b, -hb))), add(fc, add(mul(a, ha), mul(b, -hb))),
                     add(fc, add(mul(a, ha), mul(b, hb))), add(fc, add(mul(a, -ha), mul(b, hb)))]
            faces.append(FaceGeom([outer] + face_holes.get(name, []), n, planar=True))
    body = BodyGeom(faces=faces, holes=body_holes)
    frame = LocalFrame(center=center, axes=ax, dims=dims)
    return PartGeom(id=pid, bodies=[body], frame=frame)


def name_of(idx: int) -> str:
    return "xyz"[idx]
