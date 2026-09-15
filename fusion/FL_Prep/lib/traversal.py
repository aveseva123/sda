# -*- coding: utf-8 -*-
"""Обход дерева сборки: каждый компонент обрабатывается один раз, экземпляры считаются."""
import adsk.core
import adsk.fusion


class CompRecord(object):
    """Уникальный компонент и все его вхождения (occurrences)."""
    __slots__ = ('component', 'name', 'token', 'occurrences', 'min_depth', 'is_external')

    def __init__(self, component, token):
        self.component = component
        self.name = component.name
        self.token = token
        self.occurrences = []
        self.min_depth = 10 ** 6
        self.is_external = False

    @property
    def first(self):
        return self.occurrences[0] if self.occurrences else None

    @property
    def instance_count(self):
        return len(self.occurrences)

    @property
    def body_count(self):
        try:
            return self.component.bRepBodies.count
        except Exception:  # noqa: BLE001
            return 0

    @property
    def child_count(self):
        try:
            return self.component.occurrences.count
        except Exception:  # noqa: BLE001
            return 0

    @property
    def is_leaf(self):
        return self.child_count == 0

    @property
    def path(self):
        occ = self.first
        try:
            return occ.fullPathName if occ is not None else self.name
        except Exception:  # noqa: BLE001
            return self.name


def safe_token(entity):
    try:
        return entity.entityToken or ''
    except Exception:  # noqa: BLE001
        return ''


def occurrence_depth(occ):
    try:
        return occ.fullPathName.count('+')
    except Exception:  # noqa: BLE001
        return 0


def collect(design):
    """Возвращает (root, records) — records: список CompRecord в порядке первого появления,
    без корневого компонента."""
    root = design.rootComponent
    by_key = {}
    order = []
    for occ in root.allOccurrences:
        comp = occ.component
        key = safe_token(comp)
        if not key:
            # На всякий случай: без токена ключом служит id объекта компонента
            key = 'comp:' + str(comp.name) + ':' + str(id(comp))
        rec = by_key.get(key)
        if rec is None:
            rec = CompRecord(comp, key)
            by_key[key] = rec
            order.append(rec)
        rec.occurrences.append(occ)
        rec.min_depth = min(rec.min_depth, occurrence_depth(occ))
        try:
            if occ.isReferencedComponent:
                rec.is_external = True
        except Exception:  # noqa: BLE001
            pass
    return root, order


def component_points(component):
    """Все вершины всех тел компонента в локальных координатах компонента (см)."""
    points = []
    for body in component.bRepBodies:
        for vtx in body.vertices:
            p = vtx.geometry
            points.append((p.x, p.y, p.z))
    return points


def largest_planar_face_normal(component):
    """Нормаль самой большой плоской грани среди тел компонента (локальные координаты) или None."""
    best = None
    best_area = -1.0
    for body in component.bRepBodies:
        for face in body.faces:
            try:
                if face.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
                    continue
                area = face.area
                if area > best_area:
                    n = face.geometry.normal
                    best = (n.x, n.y, n.z)
                    best_area = area
            except Exception:  # noqa: BLE001
                continue
    return best
