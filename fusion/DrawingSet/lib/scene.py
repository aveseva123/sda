"""Geometry of the model as plain data: parts → bodies → faces (polygon loops), edges, holes.

Everything is in millimetres and in world (root component) coordinates. Built either from
Fusion (lib.extract) or synthetically (tests).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geom import Vec3


@dataclass
class Hole:
    """A cylindrical hole. `entry` is the point on the surface where the hole starts,
    `axis` points into the material, `depth` is the hole depth (== through for through holes)."""
    entry: Vec3
    axis: Vec3
    radius: float
    depth: float
    through: bool = False


@dataclass
class FaceGeom:
    loops: List[List[Vec3]]          # loops[0] is the outer loop, others are holes
    normal: Vec3
    planar: bool = True
    cylinder_radius: float = 0.0     # >0 for cylindrical faces


@dataclass
class EdgeGeom:
    points: List[Vec3]
    circle: Optional[Tuple[Vec3, Vec3, float]] = None   # (center, normal, radius) when a full circle


@dataclass
class BodyGeom:
    faces: List[FaceGeom] = field(default_factory=list)
    edges: List[EdgeGeom] = field(default_factory=list)
    holes: List[Hole] = field(default_factory=list)


@dataclass
class LocalFrame:
    """Oriented box of a part: centre, unit axes (length, width, thickness) and extents."""
    center: Vec3
    axes: Tuple[Vec3, Vec3, Vec3]
    dims: Tuple[float, float, float]


@dataclass
class PartGeom:
    id: str
    bodies: List[BodyGeom] = field(default_factory=list)
    frame: Optional[LocalFrame] = None

    def all_points(self) -> List[Vec3]:
        pts: List[Vec3] = []
        for b in self.bodies:
            for f in b.faces:
                for loop in f.loops:
                    pts.extend(loop)
            for e in b.edges:
                pts.extend(e.points)
        return pts


@dataclass
class Scene:
    parts: Dict[str, PartGeom] = field(default_factory=dict)
    flat_patterns: Dict[str, "FlatPatternGeom"] = field(default_factory=dict)  # component id -> flat pattern


@dataclass
class FlatPatternGeom:
    body: BodyGeom
    bend_lines: List[List[Vec3]] = field(default_factory=list)
    thickness: float = 0.0
