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


class Face(core.Base):
    def __init__(self, normal, area):
        self.geometry = core.Plane(core.Vector3D(*normal))
        self.area = area


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


class Component(core.Base):
    _counter = 0

    def __init__(self, name, material=None):
        Component._counter += 1
        self.name = name
        self.bRepBodies = Coll()
        self.occurrences = Coll()
        self.material = material
        self.entityToken = 'comp-%d' % Component._counter

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
        self.entityToken = 'occ-%d' % Occurrence._counter

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
    faces = []
    for normal, area in (((1, 0, 0), ly * lz), ((-1, 0, 0), ly * lz), ((0, 1, 0), lx * lz),
                         ((0, -1, 0), lx * lz), ((0, 0, 1), lx * ly), ((0, 0, -1), lx * ly)):
        faces.append(Face(_rot(normal, *rot), area))
    volume = lx * ly * lz
    area = 2 * (lx * ly + ly * lz + lx * lz)
    return BRepBody(name, faces, [Vertex(c) for c in corners], volume, area, material)
