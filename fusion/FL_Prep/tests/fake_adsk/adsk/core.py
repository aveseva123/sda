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
