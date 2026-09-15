"""Заглушка adsk.core: только то, что использует add-in вне UI."""


class Base(object):
    @classmethod
    def cast(cls, obj):
        return obj

    @classmethod
    def classType(cls):
        return 'adsk::core::' + cls.__name__


class SurfaceTypes(object):
    PlaneSurfaceType = 0
    CylinderSurfaceType = 1


class NamedViews(Base):
    def add(self, camera, name=''):
        return None


class DataFile(Base):
    def copy(self, folder):
        return None


class Application(Base):
    _instance = None
    logged = []

    @classmethod
    def get(cls):
        return cls._instance

    @staticmethod
    def log(message, level=0, type_=0):
        Application.logged.append(message)


class Point3D(Base):
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = x, y, z

    @classmethod
    def create(cls, x, y, z):
        return cls(x, y, z)

    def asArray(self):
        return [self.x, self.y, self.z]


class Vector3D(Point3D):
    pass


class Plane(Base):
    surfaceType = SurfaceTypes.PlaneSurfaceType

    def __init__(self, normal):
        self.normal = normal


class DropDownStyles(object):
    TextListDropDownStyle = 0


class Curve3DTypes(object):
    Line3DCurveType = 0
    Arc3DCurveType = 1
    Circle3DCurveType = 2
    NurbsCurve3DCurveType = 6


class Matrix3D(Base):
    def __init__(self, values=None):
        self.values = list(values) if values else [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    @classmethod
    def create(cls):
        return cls()

    def asArray(self):
        return list(self.values)

    def setWithArray(self, values):
        self.values = list(values)
        return True


class Line3D(Base):
    curveType = Curve3DTypes.Line3DCurveType

    def __init__(self, a, b):
        self.startPoint, self.endPoint = a, b


class Circle3D(Base):
    curveType = Curve3DTypes.Circle3DCurveType

    def __init__(self, center, normal, radius):
        self.center, self.normal, self.radius = center, normal, radius


class Attribute(Base):
    def __init__(self, group, name, value):
        self.groupName, self.name, self.value = group, name, value


class Attributes(Base):
    def __init__(self):
        self.items = []

    def add(self, group, name, value):
        self.items.append(Attribute(group, name, value))
        return self.items[-1]

    def itemsByGroup(self, group):
        return [a for a in self.items if a.groupName == group]
