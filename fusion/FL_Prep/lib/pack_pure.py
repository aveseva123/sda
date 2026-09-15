# -*- coding: utf-8 -*-
"""Чистые функции формата экспорта (без adsk): система координат детали, проекция контуров,
классификация отверстий, правило «панель», округление. Единицы — мм."""
import math

from . import geom_pure as gp

FORMAT_NAME = 'fl_prep_export'
FORMAT_VERSION = 1


def rnd(value, digits=3):
    return round(float(value), digits)


def rnd_vec(vec, digits=3):
    return [rnd(v, digits) for v in vec]


def part_frame(obb, face_normal=None):
    """Правая система координат детали: x — длина (текстура), y — ширина, z — толщина
    (наружная нормаль главной грани, если она известна). origin — центр OBB.
    obb: dict с center, dir_length, dir_thickness (см. geom_pure.obb_from_points)."""
    z = gp.v_norm(face_normal) if face_normal is not None else gp.v_norm(obb['dir_thickness'])
    if gp.v_len(z) < 1e-9:
        z = (0.0, 0.0, 1.0)
    dl = obb.get('dir_length') or (1.0, 0.0, 0.0)
    x = gp.v_sub(dl, gp.v_scale(z, gp.v_dot(dl, z)))
    if gp.v_len(x) < 1e-6:
        x = gp.basis_from_normal(z)[0]
    x = gp.v_norm(x)
    y = gp.v_norm(gp.v_cross(z, x))
    return {'origin': tuple(obb['center']), 'x': x, 'y': y, 'z': z}


def to_frame(point, frame):
    d = gp.v_sub(point, frame['origin'])
    return (gp.v_dot(d, frame['x']), gp.v_dot(d, frame['y']), gp.v_dot(d, frame['z']))


def from_frame(uvw, frame):
    o = frame['origin']
    p = gp.v_add(o, gp.v_scale(frame['x'], uvw[0]))
    p = gp.v_add(p, gp.v_scale(frame['y'], uvw[1]))
    return gp.v_add(p, gp.v_scale(frame['z'], uvw[2]))


def frame_as_dict(frame):
    return {'origin': rnd_vec(frame['origin']), 'x': rnd_vec(frame['x'], 6),
            'y': rnd_vec(frame['y'], 6), 'z': rnd_vec(frame['z'], 6)}


def arc_is_ccw(points2d, center2d):
    """Направление обхода дуги по её точкам (в 2D): True — против часовой."""
    if len(points2d) < 2:
        return True
    p0 = points2d[0]
    p1 = points2d[len(points2d) // 2] if len(points2d) > 2 else points2d[-1]
    a = (p0[0] - center2d[0], p0[1] - center2d[1])
    b = (p1[0] - center2d[0], p1[1] - center2d[1])
    return (a[0] * b[1] - a[1] * b[0]) >= 0


def loop_as_circle(segments, tol=0.01):
    """Если петля — одна окружность или дуги с общим центром и радиусом, возвращает (center2d, radius)."""
    if not segments:
        return None
    center = None
    radius = None
    for seg in segments:
        if seg['type'] not in ('circle', 'arc') or seg.get('center') is None:
            return None
        c = seg['center']
        r = seg['radius']
        if center is None:
            center, radius = c, r
            continue
        if abs(c[0] - center[0]) > tol or abs(c[1] - center[1]) > tol or abs(r - radius) > tol:
            return None
    if len(segments) == 1 and segments[0]['type'] == 'circle':
        return center, radius
    # дуги: замкнутость проверяем по концам
    first = segments[0]['points'][0]
    last = segments[-1]['points'][-1]
    if math.hypot(first[0] - last[0], first[1] - last[1]) > tol * 10:
        return None
    return center, radius


def face_kind(face_normal, frame_z, cos_limit=0.9):
    d = gp.v_dot(gp.v_norm(face_normal), frame_z)
    if d > cos_limit:
        return 'main'
    if d < -cos_limit:
        return 'back'
    return 'edge'


def is_panel(dims, main_face_area, max_thickness=60.0):
    """dims — (Д, Ш, Т) мм по убыванию. Панель: тонкая относительно ширины, главная грань
    покрывает большую часть габарита."""
    if not dims or dims[1] <= 0:
        return False
    length, width, thickness = dims
    if thickness > max_thickness or thickness > 0.5 * width:
        return False
    return main_face_area >= 0.5 * length * width


def matrix_cm_to_mm(values16):
    """Matrix3D.asArray() (см, row-major, перенос в элементах 3, 7, 11) → мм."""
    m = [float(v) for v in values16]
    for i in (3, 7, 11):
        m[i] *= 10.0
    return [rnd(v, 6) for v in m]


def component_kind(name, material_name, has_children, body_count, settings):
    if gp.has_prefix(name, settings.get('helper_prefixes', [])):
        return 'helper'
    if gp.has_prefix(name, settings.get('hardware_prefixes', [])) or \
            gp.matches_keywords(material_name, settings.get('hardware_material_keywords', [])):
        return 'hardware'
    if has_children:
        return 'assembly'
    if body_count > 0:
        return 'part'
    return 'empty'


def parent_path(full_path):
    """'Тумба:1+Полка:2' -> 'Тумба:1'; 'Полка:2' -> None"""
    if '+' not in (full_path or ''):
        return None
    return full_path.rsplit('+', 1)[0]


def dedupe_drillings(drillings, tol=0.05):
    """Сквозные отверстия видны с двух граней (main/back): оставляем одно с признаком through."""
    result = []
    used = [False] * len(drillings)
    for i, d in enumerate(drillings):
        if used[i]:
            continue
        item = dict(d)
        item['through'] = False
        if d['face'] in ('main', 'back'):
            for j in range(i + 1, len(drillings)):
                e = drillings[j]
                if used[j] or e['face'] == d['face'] or e['face'] == 'edge':
                    continue
                if abs(e['center'][0] - d['center'][0]) <= tol and abs(e['center'][1] - d['center'][1]) <= tol \
                        and abs(e['diameter'] - d['diameter']) <= tol:
                    used[j] = True
                    item['through'] = True
                    break
        result.append(item)
    return result
