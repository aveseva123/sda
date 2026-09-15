"""Заглушка adsk.fusion: объектная модель дизайна для тестов аудита."""
import math

from . import core


class DesignTypes(object):
    DirectDesignType = 0
    ParametricDesignType = 1


class Coll(list):
    """Коллекция Fusion: count + item() + итерация."""
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


class Material(core.Base):
    def __init__(self, name):
        self.name = name


class TriangleMeshQualityOptions(object):
    LowQualityTriangleMesh = 8
    NormalQualityTriangleMesh = 11


class _CurveEvaluator(object):
    def __init__(self, points):
        self.points = points

    def getParameterExtents(self):
        return True, 0.0, 1.0

    def getStrokes(self, a, b, tol):
        return True, [core.Point3D(*p) for p in self.points]


class BRepEdge(core.Base):
    def __init__(self, geometry, points):
        self.geometry = geometry
        self.evaluator = _CurveEvaluator(points)


class BRepCoEdge(core.Base):
    def __init__(self, edge, opposed=False):
        self.edge = edge
        self.isOpposedToEdge = opposed


class BRepLoop(core.Base):
    def __init__(self, coedges, is_outer):
        self.coEdges = Coll(coedges)
        self.isOuter = is_outer


class _FaceEvaluator(object):
    def __init__(self, normal):
        self.normal = normal

    def getNormalAtPoint(self, point):
        return True, core.Vector3D(*self.normal)


class Face(core.Base):
    def __init__(self, normal, area, loops=None, point=(0, 0, 0)):
        self.geometry = core.Plane(core.Vector3D(*normal))
        self.area = area
        self.loops = Coll(loops or [])
        self.evaluator = _FaceEvaluator(normal)
        self.pointOnFace = core.Point3D(*point)
        self.isParamReversed = False


class _TriangleMesh(object):
    def __init__(self, coords, indices):
        self.nodeCoordinatesAsFloat = coords
        self.nodeIndices = indices


class _MeshCalculator(object):
    def __init__(self, coords, indices):
        self._coords, self._indices = coords, indices
        self.surfaceTolerance = 0.0

    def setQuality(self, q):
        return True

    def calculate(self):
        return _TriangleMesh(self._coords, self._indices)


class _MeshManager(object):
    def __init__(self, coords, indices):
        self._coords, self._indices = coords, indices

    def createMeshCalculator(self):
        return _MeshCalculator(self._coords, self._indices)


class Vertex(core.Base):
    def __init__(self, xyz):
        self.geometry = core.Point3D(*xyz)


class BRepBody(core.Base):
    _counter = 0

    def __init__(self, name, faces, vertices, volume, area, material=None):
        BRepBody._counter += 1
        self.name = name
        self.faces = Coll(faces)
        self.vertices = Coll(vertices)
        self.volume = volume
        self.area = area
        self.material = material
        self.isLightBulbOn = True
        self.isVisible = True
        self.entityToken = 'body-%d' % BRepBody._counter
        self.parentComponent = None
        self.meshManager = _MeshManager([], [])


class Component(core.Base):
    _counter = 0

    def __init__(self, name, material=None):
        Component._counter += 1
        self.name = name
        self.bRepBodies = Coll()
        self.occurrences = Coll()
        self.material = material
        self.entityToken = 'comp-%d' % Component._counter
        self.partNumber = ''
        self.description = ''
        self.attributes = core.Attributes()

    def add_body(self, body):
        body.parentComponent = self
        self.bRepBodies.append(body)
        return body

    @property
    def allOccurrences(self):
        result = Coll()

        def walk(comp, prefix):
            for occ in comp.occurrences:
                occ.fullPathName = (prefix + '+' if prefix else '') + occ.name
                result.append(occ)
                walk(occ.component, occ.fullPathName)
        walk(self, '')
        return result


class Occurrence(core.Base):
    _counter = 0

    def __init__(self, component, index=1):
        Occurrence._counter += 1
        self.component = component
        self.name = '%s:%d' % (component.name, index)
        self.fullPathName = self.name
        self.isLightBulbOn = True
        self.isVisible = True
        self.isReferencedComponent = False
        self.isGrounded = False
        self.entityToken = 'occ-%d' % Occurrence._counter
        self.transform2 = core.Matrix3D()

    @property
    def childOccurrences(self):
        return self.component.occurrences


class Snapshots(core.Base):
    def __init__(self):
        self.hasPendingSnapshot = False


class DocumentReference(core.Base):
    def __init__(self, name, out_of_date):
        self.isOutOfDate = out_of_date
        self.dataFile = type('DF', (), {'name': name})()


class Document(core.Base):
    def __init__(self, name):
        self.name = name
        self.documentReferences = Coll()
        self.isSaved = True


class Design(core.Base):
    def __init__(self, name='Design'):
        self.rootComponent = Component('Root')
        self.snapshots = Snapshots()
        self.designType = DesignTypes.ParametricDesignType
        self.parentDocument = Document(name)

    def add_occurrence(self, component, parent=None):
        parent = parent or self.rootComponent
        index = sum(1 for o in parent.occurrences if o.component is component) + 1
        occ = Occurrence(component, index)
        parent.occurrences.append(occ)
        return occ


# ---------------------------------------------------------------- построение тел

def _rot(vec, rx, ry, rz):
    x, y, z = vec
    c, s = math.cos(rx), math.sin(rx)
    y, z = y * c - z * s, y * s + z * c
    c, s = math.cos(ry), math.sin(ry)
    x, z = x * c + z * s, -x * s + z * c
    c, s = math.cos(rz), math.sin(rz)
    x, y = x * c - y * s, x * s + y * c
    return (x, y, z)


def make_box(name, lx, ly, lz, rot=(0.0, 0.0, 0.0), offset=(0.0, 0.0, 0.0), material=None):
    """Параллелепипед lx×ly×lz (см), повёрнутый на углы rot (рад) и сдвинутый на offset."""
    corners = []
    for sx in (-0.5, 0.5):
        for sy in (-0.5, 0.5):
            for sz in (-0.5, 0.5):
                p = _rot((sx * lx, sy * ly, sz * lz), *rot)
                corners.append((p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]))
    def tp(p):
        q = _rot(p, *rot)
        return (q[0] + offset[0], q[1] + offset[1], q[2] + offset[2])

    hx, hy, hz = lx / 2.0, ly / 2.0, lz / 2.0
    # грани: нормаль, площадь, 4 угла против часовой при взгляде снаружи
    spec = [
        ((0, 0, 1), lx * ly, [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), lx * ly, [(-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)]),
        ((1, 0, 0), ly * lz, [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]),
        ((-1, 0, 0), ly * lz, [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)]),
        ((0, 1, 0), lx * lz, [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
        ((0, -1, 0), lx * lz, [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)]),
    ]
    faces = []
    for normal, area, quad in spec:
        pts = [tp(q) for q in quad]
        coedges = []
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            edge = BRepEdge(core.Line3D(core.Point3D(*a), core.Point3D(*b)), [a, b])
            coedges.append(BRepCoEdge(edge))
        center = tuple(sum(p[k] for p in pts) / 4.0 for k in range(3))
        faces.append(Face(_rot(normal, *rot), area, [BRepLoop(coedges, True)], center))
    volume = lx * ly * lz
    area = 2 * (lx * ly + ly * lz + lx * lz)
    body = BRepBody(name, faces, [Vertex(c) for c in corners], volume, area, material)
    # сетка: 12 треугольников по углам (corners в порядке sx,sy,sz)
    coords = []
    for c in corners:
        coords.extend(c)
    idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]
    body.meshManager = _MeshManager(coords, idx)
    body._rot, body._offset = rot, offset
    return body


def add_hole(body, face_index, u, v, radius, through=True):
    """Круглое отверстие на грани face_index (0 — верх +Z, 1 — низ −Z): внутренняя петля-окружность.
    u, v — смещение центра в локальных осях коробки (см)."""
    import math as _m
    rot, offset = body._rot, body._offset

    def tp(p):
        q = _rot(p, *rot)
        return (q[0] + offset[0], q[1] + offset[1], q[2] + offset[2])

    targets = [face_index] + ([1 - face_index] if through and face_index in (0, 1) else [])
    for fi in targets:
        face = body.faces[fi]
        n_local = (0, 0, 1) if fi == 0 else (0, 0, -1)
        # z-координата грани в локальной системе коробки
        z = max(p[2] for p in _unrot_corners(body)) if fi == 0 else min(p[2] for p in _unrot_corners(body))
        center_local = (u, v, z)
        pts = [tp((u + radius * _m.cos(t), v + radius * _m.sin(t), z)) for t in
               [i * 2 * _m.pi / 24 for i in range(25)]]
        circle = core.Circle3D(core.Point3D(*tp(center_local)), core.Vector3D(*_rot(n_local, *rot)), radius)
        face.loops.append(BRepLoop([BRepCoEdge(BRepEdge(circle, pts))], False))


def _unrot_corners(body):
    # восстановить локальные (до поворота) углы по вершинам: обратный поворот
    rot, offset = body._rot, body._offset
    out = []
    for vtx in body.vertices:
        p = vtx.geometry
        q = (p.x - offset[0], p.y - offset[1], p.z - offset[2])
        # обратный поворот: rz, ry, rx с обратными знаками в обратном порядке
        out.append(_rot_inv(q, *rot))
    return out


def _rot_inv(vec, rx, ry, rz):
    x, y, z = vec
    c, s = math.cos(-rz), math.sin(-rz)
    x, y = x * c - y * s, x * s + y * c
    c, s = math.cos(-ry), math.sin(-ry)
    x, z = x * c + z * s, -x * s + z * c
    c, s = math.cos(-rx), math.sin(-rx)
    y, z = y * c - z * s, y * s + z * c
    return (x, y, z)
