"""A small stand-in for the `adsk` package: enough of core/fusion to run the whole pipeline offline.

Geometry is built as BRep-like objects (bodies → faces → loops → co-edges → edges with
evaluators) from axis-aligned boxes with holes, in centimetres like the real API.
"""
from __future__ import annotations

import math
import sys
import types
from typing import Dict, List, Optional, Sequence, Tuple

CM = 10.0


# ----------------------------------------------------------------------
# core
# ----------------------------------------------------------------------
class P3:
    def __init__(self, x: float, y: float, z: float):
        self.x, self.y, self.z = x, y, z

    def copy(self):
        return P3(self.x, self.y, self.z)


class V3(P3):
    def add(self, o):
        self.x += o.x; self.y += o.y; self.z += o.z

    def transformBy(self, m):
        pass


class Curve3DTypes:
    Line3DCurveType = 0
    Arc3DCurveType = 1
    Circle3DCurveType = 2
    NurbsCurve3DCurveType = 6


class SurfaceTypes:
    PlaneSurfaceType = 0
    CylinderSurfaceType = 1


class UploadStates:
    UploadProcessing = 0
    UploadFinished = 1
    UploadFailed = 2


class DialogResults:
    DialogOK = 0
    DialogCancel = 1


class PaletteDockingStates:
    PaletteDockStateRight = 2


class _Base:
    @classmethod
    def cast(cls, arg):
        return arg


class CustomEventArgs(_Base):
    pass


class Matrix3D:
    @staticmethod
    def create():
        return Matrix3D()

    def copy(self):
        return Matrix3D()

    def invert(self):
        return True

    def transformBy(self, m):
        pass

    @property
    def translation(self):
        return V3(0, 0, 0)

    @translation.setter
    def translation(self, v):
        pass


class Vector3D:
    @staticmethod
    def create(x, y, z):
        return V3(x, y, z)


class ProgressDialog:
    def __init__(self):
        self.isCancelButtonShown = True
        self.message = ""
        self.progressValue = 0
        self.shown = False

    def show(self, title, message, lo, hi, delay=0):
        self.shown = True
        return True

    def hide(self):
        self.shown = False


class FolderDialog:
    title = ""
    folder = "/tmp"

    def showDialog(self):
        return DialogResults.DialogOK


class CommandDefinitions:
    def __init__(self):
        self.count = 0

    def item(self, i):
        return None

    def itemById(self, cid):
        return None


class Workspaces:
    def itemById(self, wid):
        return None


class UserInterface:
    def __init__(self):
        self.messages: List[str] = []
        self.commandDefinitions = CommandDefinitions()
        self.workspaces = Workspaces()

    def messageBox(self, text, title=""):
        self.messages.append(text)

    def createProgressDialog(self):
        return ProgressDialog()

    def createFolderDialog(self):
        return FolderDialog()


class DataFile:
    def __init__(self, name):
        self.name = name
        self.parentFolder = None
        self.isComplete = True
        self.versionNumber = 1


class Document:
    def __init__(self, name, design):
        self.name = name
        self.isSaved = True
        self.isModified = False
        self.isActive = True
        self.dataFile = DataFile(name)
        self._design = design
        self.products = self

    def itemByProductType(self, t):
        return self._design if t == "DesignProductType" else None

    def save(self, desc=""):
        self.isModified = False
        return True

    def activate(self):
        return True


class Application:
    _instance = None

    def __init__(self, design, doc_name="Шкаф барный v7"):
        self.userInterface = UserInterface()
        self.activeDocument = Document(doc_name, design)
        self.activeProduct = design
        self.version = "2.0.99999 (fake)"
        self.logs: List[str] = []
        self.events: List[Tuple[str, str]] = []
        Application._instance = self

    @staticmethod
    def get():
        return Application._instance

    def log(self, message, level=0, kind=0):
        self.logs.append(message)

    def fireCustomEvent(self, event_id, info=""):
        self.events.append((event_id, info))
        return True


# ----------------------------------------------------------------------
# fusion: BRep
# ----------------------------------------------------------------------
class Geometry:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Evaluator:
    def __init__(self, points: List[P3]):
        self._points = points

    def getParameterExtents(self):
        return True, 0.0, 1.0

    def getStrokes(self, t0, t1, tol):
        return True, list(self._points)

    def getNormalAtPoint(self, p):
        return True, self._normal

    def withNormal(self, n):
        self._normal = n
        return self


class Vertex:
    def __init__(self, p: P3):
        self.geometry = p


class Edge:
    def __init__(self, points: List[P3], circle: Optional[Tuple[P3, V3, float]] = None):
        self.startVertex = Vertex(points[0])
        self.endVertex = Vertex(points[-1])
        self.faces: List["Face"] = []
        self.evaluator = Evaluator(points)
        if circle:
            c, n, r = circle
            self.geometry = Geometry(curveType=Curve3DTypes.Circle3DCurveType, center=c, normal=n, radius=r)
        else:
            self.geometry = Geometry(curveType=Curve3DTypes.Line3DCurveType)


class CoEdge:
    def __init__(self, edge: Edge, opposed: bool):
        self.edge = edge
        self.isOpposedToEdge = opposed


class Loop:
    def __init__(self, coedges: List[CoEdge], is_outer: bool):
        self.coEdges = coedges
        self.edges = [c.edge for c in coedges]
        self.isOuter = is_outer


class Face:
    def __init__(self, loops: List[Loop], planar: bool, normal: V3, area: float, radius: float = 0.0, point=None):
        self.loops = loops
        self.edges = [e for l in loops for e in l.edges]
        if planar:
            self.geometry = Geometry(surfaceType=SurfaceTypes.PlaneSurfaceType, normal=normal)
        else:
            self.geometry = Geometry(surfaceType=SurfaceTypes.CylinderSurfaceType, radius=radius)
        self.area = area
        self.evaluator = Evaluator([]).withNormal(normal)
        self.pointOnFace = point or P3(0, 0, 0)
        for e in self.edges:
            if self not in e.faces:
                e.faces.append(self)


class OBB:
    def __init__(self, center: P3, dims_cm: Tuple[float, float, float]):
        self.centerPoint = center
        self.lengthDirection, self.widthDirection, self.heightDirection = V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)
        self.length, self.width, self.height = dims_cm


class Material:
    def __init__(self, name):
        self.name = name


class Body:
    def __init__(self, faces: List[Face], obb: OBB, material: str, sheet_metal=False):
        self.faces = faces
        self.edges = [e for f in faces for e in f.edges]
        self.isSolid = True
        self.isVisible = True
        self.isSheetMetal = sheet_metal
        self.material = Material(material)
        self.orientedMinimumBoundingBox = obb
        self.attributes = Attributes()


class Attribute:
    def __init__(self, value):
        self.value = value


class Attributes:
    def __init__(self, items=None):
        self._items = items or {}

    def itemByName(self, g, n):
        v = self._items.get((g, n))
        return Attribute(v) if v is not None else None


class Component:
    _n = 0

    def __init__(self, name, attrs=None):
        Component._n += 1
        self.id = f"comp{Component._n}"
        self.name = name
        self.partNumber = ""
        self.description = ""
        self.material = None
        self.attributes = Attributes(attrs)
        self.constructionPlanes: List = []
        self.sketches: List = []
        self.occurrences: List[Occurrence] = []
        self.flatPattern = None
        self.bRepBodies: List[Body] = []
        self.parentDesign = None


class Occurrence:
    def __init__(self, comp: Component, bodies: List[Body], children: Optional[List["Occurrence"]] = None, obb=None):
        self.component = comp
        self.name = comp.name + ":1"
        self.fullPathName = self.name
        self.bRepBodies = bodies
        self.childOccurrences = children or []
        self.isLightBulbOn = True
        self.isVisible = True
        self.orientedMinimumBoundingBox = obb or (bodies[0].orientedMinimumBoundingBox if bodies else None)
        self.assemblyContext = None
        for c in self.childOccurrences:
            c.fullPathName = self.fullPathName + "+" + c.name
            c.assemblyContext = self


class Storyboards:
    def itemByName(self, name):
        return None


class AnimationManager:
    storyboards = Storyboards()


class Design:
    def __init__(self, root: Component, comps: List[Component]):
        self.rootComponent = root
        self.allComponents = comps
        self.animationManager = AnimationManager()
        self.designType = 1
        root.parentDesign = self
        for c in comps:
            c.parentDesign = self

    @staticmethod
    def cast(x):
        return x


# ----------------------------------------------------------------------
# geometry builder (mm in, cm inside the fake API)
# ----------------------------------------------------------------------
AX = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _p(v) -> P3:
    return P3(v[0] / CM, v[1] / CM, v[2] / CM)


def _circle_pts(center, normal, r, n=24):
    nx, ny, nz = normal
    ref = (1.0, 0.0, 0.0) if abs(nx) < 0.9 else (0.0, 1.0, 0.0)
    ux, uy, uz = (ny * ref[2] - nz * ref[1], nz * ref[0] - nx * ref[2], nx * ref[1] - ny * ref[0])
    ln = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / ln, uy / ln, uz / ln
    vx, vy, vz = (ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux)
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * (i % n) / n
        pts.append((center[0] + r * (ux * math.cos(a) + vx * math.sin(a)),
                    center[1] + r * (uy * math.cos(a) + vy * math.sin(a)),
                    center[2] + r * (uz * math.cos(a) + vz * math.sin(a))))
    return pts


def fake_box_body(center, dims, holes=(), material="ЛДСП", sheet_metal=False) -> Body:
    """holes: (face '+x'.., u, v, radius, depth|None) as in tests.synth.box_part."""
    half = [d / 2 for d in dims]
    faces: List[Face] = []
    hole_loops: Dict[str, List[Loop]] = {}
    circle_edges: Dict[Tuple, Edge] = {}

    def circle_edge(c, n, r) -> Edge:
        key = (round(c[0], 3), round(c[1], 3), round(c[2], 3), round(r, 3))
        if key not in circle_edges:
            pts = [_p(q) for q in _circle_pts(c, n, r)]
            circle_edges[key] = Edge(pts, circle=(_p(c), V3(*n), r / CM))
        return circle_edges[key]

    for face_name, u, v, r, depth in holes:
        idx = "xyz".index(face_name[1])
        sgn = 1.0 if face_name[0] == "+" else -1.0
        others = [i for i in range(3) if i != idx]
        n = [0.0, 0.0, 0.0]
        n[idx] = sgn
        c = list(center)
        c[idx] += sgn * half[idx]
        c[others[0]] += u
        c[others[1]] += v
        through = depth is None or depth >= dims[idx] - 1e-6
        d = dims[idx] if through else depth
        bottom = list(c)
        bottom[idx] -= sgn * d
        top_edge = circle_edge(tuple(c), tuple(n), r)
        bot_edge = circle_edge(tuple(bottom), tuple(n), r)
        hole_loops.setdefault(face_name, []).append(Loop([CoEdge(top_edge, False)], False))
        if through:
            opp = ("-" if sgn > 0 else "+") + "xyz"[idx]
            hole_loops.setdefault(opp, []).append(Loop([CoEdge(bot_edge, False)], False))
        else:
            faces.append(Face([Loop([CoEdge(bot_edge, False)], True)], True, V3(*[-x for x in n]),
                              math.pi * r * r / CM / CM, point=_p(bottom)))
        cyl = Face([Loop([CoEdge(top_edge, False)], True), Loop([CoEdge(bot_edge, False)], False)],
                   False, V3(0, 0, 0), 2 * math.pi * r * d / CM / CM, radius=r / CM)
        faces.append(cyl)

    line_edges: Dict[Tuple, Edge] = {}

    def line_edge(a, b) -> Edge:
        ka = tuple(round(x, 3) for x in a)
        kb = tuple(round(x, 3) for x in b)
        key = (ka, kb) if ka <= kb else (kb, ka)
        if key not in line_edges:
            line_edges[key] = Edge([_p(a), _p(b)])
        return line_edges[key], (ka > kb)

    for idx in range(3):
        for sgn in (1.0, -1.0):
            name = ("+" if sgn > 0 else "-") + "xyz"[idx]
            others = [i for i in range(3) if i != idx]
            n = [0.0, 0.0, 0.0]
            n[idx] = sgn
            fc = list(center)
            fc[idx] += sgn * half[idx]
            a, b = others
            corners = []
            for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = list(fc)
                p[a] += sa * half[a]
                p[b] += sb * half[b]
                corners.append(tuple(p))
            coedges = []
            for i in range(4):
                e, opposed = line_edge(corners[i], corners[(i + 1) % 4])
                coedges.append(CoEdge(e, opposed))
            area = dims[a] * dims[b] / CM / CM
            faces.append(Face([Loop(coedges, True)] + hole_loops.get(name, []), True, V3(*n), area, point=_p(fc)))
    obb = OBB(_p(center), tuple(d / CM for d in dims))
    return Body(faces, obb, material, sheet_metal)


def build_fake_design():
    """Same cabinet as tests.sample_cabinet, as a fake Fusion design."""
    from tests.sample_cabinet import SPEC
    comps: List[Component] = []
    occs: List[Occurrence] = []
    shared: Dict[str, Component] = {}
    for pid, title, pos, material, cat, center, dims, holes in SPEC:
        name = f"37-4_В1_П{pos}_{title}"
        comp = shared.get(name)
        if comp is None:
            comp = Component(name, attrs={("DrawingSet", "edge"): "ПВХ 2 мм"} if pid == "door" else None)
            shared[name] = comp
            comps.append(comp)
        body = fake_box_body(center, dims, holes, material, sheet_metal=(pid == "bracket"))
        occ = Occurrence(comp, [body])
        if name in [o.component.name for o in occs]:
            occ.name = name + ":2"
            occ.fullPathName = occ.name
        occs.append(occ)
    root = Component("Шкаф барный v7")
    root.occurrences = occs
    return Design(root, [root] + comps), occs


def install() -> types.ModuleType:
    """Registers the fake `adsk` package in sys.modules and returns it."""
    adsk = types.ModuleType("adsk")
    core = types.ModuleType("adsk.core")
    fusion = types.ModuleType("adsk.fusion")
    drawing = types.ModuleType("adsk.drawing")
    for name, obj in list(globals().items()):
        if isinstance(obj, type):
            setattr(core, name, obj)
            setattr(fusion, name, obj)
    fusion.Storyboards = Storyboards
    fusion.Component = Component
    fusion.FlatPattern = type("FlatPattern", (), {})
    Component.createFlatPattern = lambda self, face: None
    drawing.PDFExportOptions = type("PDFExportOptions", (), {})
    adsk.core, adsk.fusion, adsk.drawing = core, fusion, drawing
    adsk.doEvents = lambda: None
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core
    sys.modules["adsk.fusion"] = fusion
    sys.modules["adsk.drawing"] = drawing
    return adsk
