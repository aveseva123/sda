"""Minimal duck-typed stand-ins for the Fusion objects used by lib.model (tests only)."""
from __future__ import annotations

from typing import List, Optional


class P:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z


class OBB:
    """Oriented bounding box in centimetres, axis aligned."""
    def __init__(self, cx, cy, cz, l, w, h):
        self.centerPoint = P(cx / 10, cy / 10, cz / 10)
        self.lengthDirection, self.widthDirection, self.heightDirection = P(1, 0, 0), P(0, 1, 0), P(0, 0, 1)
        self.length, self.width, self.height = l / 10, w / 10, h / 10


class Material:
    def __init__(self, name):
        self.name = name


class Attr:
    def __init__(self, value):
        self.value = value


class Attributes:
    def __init__(self, items=None):
        self._items = items or {}

    def itemByName(self, group, name):
        v = self._items.get((group, name))
        return Attr(v) if v is not None else None


class Geometry:
    def __init__(self, object_type, radius=0.0):
        self.objectType = object_type
        self.radius = radius


class Face:
    def __init__(self, geometry, area=1.0):
        self.geometry, self.area = geometry, area


class Body:
    def __init__(self, obb: OBB, material="ЛДСП", is_sheet_metal=False, faces=None, attrs=None):
        self.orientedMinimumBoundingBox = obb
        self.material = Material(material) if material else None
        self.isSolid = True
        self.isVisible = True
        self.isSheetMetal = is_sheet_metal
        self.faces = faces or []
        self.attributes = Attributes(attrs)


class Component:
    _ids = 0

    def __init__(self, name, attrs=None):
        Component._ids += 1
        self.id = f"comp{Component._ids}"
        self.name = name
        self.partNumber = ""
        self.description = ""
        self.material = None
        self.attributes = Attributes(attrs)
        self.constructionPlanes: List = []
        self.sketches: List = []
        self.occurrences: List[Occurrence] = []


class Occurrence:
    def __init__(self, comp: Component, bodies=None, children: Optional[List["Occurrence"]] = None,
                 light=True, obb: Optional[OBB] = None):
        self.component = comp
        self.name = comp.name + ":1"
        self.bRepBodies = bodies or []
        self.childOccurrences = children or []
        self.isLightBulbOn = light
        self.fullPathName = self.name
        self.assemblyContext = None
        for c in self.childOccurrences:
            c.fullPathName = self.fullPathName + "+" + c.name
            c.assemblyContext = self
        self.orientedMinimumBoundingBox = obb
        if obb is None and bodies:
            self.orientedMinimumBoundingBox = bodies[0].orientedMinimumBoundingBox


class Named:
    def __init__(self, name):
        self.name = name


class Root(Component):
    def __init__(self, name, occurrences):
        super().__init__(name)
        self.occurrences = occurrences
