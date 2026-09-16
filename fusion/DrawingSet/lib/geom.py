"""3D/2D geometry helpers and orthographic views. Pure module, millimetres."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

Vec3 = Tuple[float, float, float]
Vec2 = Tuple[float, float]


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Vec3) -> Vec3:
    n = norm(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def axis_name(name: str) -> Vec3:
    name = (name or "").strip().upper()
    sign = -1.0 if name.startswith("-") else 1.0
    base = {"X": (1.0, 0.0, 0.0), "Y": (0.0, 1.0, 0.0), "Z": (0.0, 0.0, 1.0)}.get(name.lstrip("+-"), (0.0, 1.0, 0.0))
    return mul(base, sign)


def orthogonalize(v: Vec3, against: Vec3) -> Vec3:
    a = unit(against)
    return unit(sub(v, mul(a, dot(v, a))))


# ----------------------------------------------------------------------
@dataclass(frozen=True)
class View:
    """Orthographic camera. `forward` is the viewing direction, `up` the paper-up direction."""
    forward: Vec3
    up: Vec3
    name: str = ""

    @property
    def right(self) -> Vec3:
        return unit(cross(self.forward, self.up))

    def project(self, p: Vec3) -> Tuple[float, float, float]:
        """Returns (x, y, depth) with depth growing towards the viewer."""
        return (dot(p, self.right), dot(p, self.up), -dot(p, self.forward))

    def project2(self, p: Vec3) -> Vec2:
        return (dot(p, self.right), dot(p, self.up))


def make_view(forward: Vec3, up_hint: Vec3, name: str = "") -> View:
    f = unit(forward)
    u = orthogonalize(up_hint, f)
    if norm(u) < 1e-9:
        # up hint parallel to forward: pick any perpendicular
        u = orthogonalize((0.0, 0.0, 1.0) if abs(f[2]) < 0.9 else (1.0, 0.0, 0.0), f)
    return View(f, u, name)


def standard_views(up: Vec3, front: Vec3, first_angle: bool = True) -> dict:
    """Front / top / side / iso views for an object whose `front` points towards the viewer.

    first_angle (ISO): the top view goes below the front view and the LEFT view to the right.
    third angle (ASME): the top view goes above and the RIGHT view to the right.
    """
    up = unit(up)
    front = orthogonalize(front, up)
    front_view = make_view(mul(front, -1.0), up, "front")
    right = front_view.right
    if first_angle:
        top = make_view(mul(up, -1.0), front, "top")          # object's front at the top edge of the plan
        side = make_view(right, up, "left")                    # viewer on the left looking right
    else:
        top = make_view(mul(up, -1.0), mul(front, -1.0), "top")
        side = make_view(mul(right, -1.0), up, "right")
    iso_forward = mul(unit(add(add(front, right), up)), -1.0)
    iso = make_view(iso_forward, up, "iso")
    return {"front": front_view, "top": top, "side": side, "iso": iso}


# ----------------------------------------------------------------------
def polygon_area(pts: Sequence[Vec2]) -> float:
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def polygon_centroid(pts: Sequence[Vec2]) -> Vec2:
    a = polygon_area(pts)
    if abs(a) < 1e-9:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (sum(xs) / len(xs), sum(ys) / len(ys)) if pts else (0.0, 0.0)
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        w = x1 * y2 - x2 * y1
        cx += (x1 + x2) * w
        cy += (y1 + y2) * w
    return (cx / (6 * a), cy / (6 * a))


def bbox2(points: Iterable[Vec2]) -> Tuple[float, float, float, float]:
    xs, ys = [], []
    for x, y in points:
        xs.append(x)
        ys.append(y)
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


def centroid3(points: Sequence[Vec3]) -> Vec3:
    n = len(points)
    if n == 0:
        return (0.0, 0.0, 0.0)
    return (sum(p[0] for p in points) / n, sum(p[1] for p in points) / n, sum(p[2] for p in points) / n)


def circle_points(center: Vec3, normal: Vec3, radius: float, segments: int = 36) -> List[Vec3]:
    n = unit(normal)
    ref = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = unit(cross(n, ref))
    v = cross(n, u)
    return [add(center, add(mul(u, radius * math.cos(2 * math.pi * i / segments)),
                            mul(v, radius * math.sin(2 * math.pi * i / segments)))) for i in range(segments)]


def is_circle_2d(points: Sequence[Vec2], tol: float = 0.05) -> Tuple[bool, Vec2, float]:
    """Detects a projected circle (used to draw holes as true circles instead of polylines)."""
    if len(points) < 8:
        return False, (0.0, 0.0), 0.0
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    rs = [math.hypot(p[0] - cx, p[1] - cy) for p in points]
    r = sum(rs) / len(rs)
    if r < 1e-6:
        return False, (cx, cy), 0.0
    if max(abs(x - r) for x in rs) <= max(tol, 0.01 * r):
        return True, (cx, cy), r
    return False, (cx, cy), r


STANDARD_SCALES = [10.0, 5.0, 4.0, 2.5, 2.0, 1.0, 1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 25, 1 / 50, 1 / 100]


def pick_scale(width_mm: float, height_mm: float, avail_w: float, avail_h: float) -> float:
    """Largest standard scale at which width×height fits into the available area."""
    if width_mm <= 0 or height_mm <= 0:
        return 1.0
    for s in STANDARD_SCALES:
        if width_mm * s <= avail_w and height_mm * s <= avail_h:
            return s
    return STANDARD_SCALES[-1]


def scale_label(s: float) -> str:
    if s >= 1.0:
        v = s
        return f"{v:g}:1"
    inv = 1.0 / s
    return f"1:{inv:g}"
