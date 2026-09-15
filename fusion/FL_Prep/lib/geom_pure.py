# -*- coding: utf-8 -*-
"""Чистая геометрия и правила аудита. Никаких импортов adsk — модуль тестируется обычным python3.

Все длины здесь — в тех единицах, в которых переданы точки (в add-in — миллиметры).
"""
import math
import re

_EPS = 1e-9

# ---------------------------------------------------------------- векторы

def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_len(a):
    return math.sqrt(v_dot(a, a))


def v_norm(a):
    n = v_len(a)
    if n < _EPS:
        return (0.0, 0.0, 0.0)
    return (a[0] / n, a[1] / n, a[2] / n)


def basis_from_normal(normal):
    """Два единичных вектора u, v, перпендикулярных normal и друг другу."""
    n = v_norm(normal)
    helper = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = v_norm(v_cross(n, helper))
    v = v_norm(v_cross(n, u))
    return u, v


# ---------------------------------------------------------------- 2D: оболочка и минимальный прямоугольник

def convex_hull(points):
    """Выпуклая оболочка (monotone chain). points: список (x, y). Возвращает вершины против часовой."""
    pts = sorted(set((float(x), float(y)) for x, y in points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_area_rect(points):
    """Прямоугольник минимальной площади вокруг точек (x, y).

    Возвращает dict: length (>= width), width, dir_length (ux, uy), dir_width, center (cx, cy).
    Перебор направлений по рёбрам выпуклой оболочки (rotating calipers).
    """
    hull = convex_hull(points)
    if not hull:
        return None
    if len(hull) == 1:
        return {'length': 0.0, 'width': 0.0, 'dir_length': (1.0, 0.0), 'dir_width': (0.0, 1.0),
                'center': hull[0]}
    best = None
    n = len(hull)
    edges = n if n > 2 else 1
    for i in range(edges):
        ax, ay = hull[i]
        bx, by = hull[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        if length < _EPS:
            continue
        ux, uy = dx / length, dy / length
        vx, vy = -uy, ux
        min_u = min_v = float('inf')
        max_u = max_v = float('-inf')
        for px, py in hull:
            pu = px * ux + py * uy
            pv = px * vx + py * vy
            min_u, max_u = min(min_u, pu), max(max_u, pu)
            min_v, max_v = min(min_v, pv), max(max_v, pv)
        area = (max_u - min_u) * (max_v - min_v)
        if best is None or area < best[0] - _EPS:
            best = (area, ux, uy, vx, vy, min_u, max_u, min_v, max_v)
    if best is None:
        return None
    _, ux, uy, vx, vy, min_u, max_u, min_v, max_v = best
    ext_u = max_u - min_u
    ext_v = max_v - min_v
    cu = (min_u + max_u) / 2.0
    cv = (min_v + max_v) / 2.0
    center = (cu * ux + cv * vx, cu * uy + cv * vy)
    if ext_u >= ext_v:
        return {'length': ext_u, 'width': ext_v, 'dir_length': (ux, uy), 'dir_width': (vx, vy), 'center': center}
    return {'length': ext_v, 'width': ext_u, 'dir_length': (vx, vy), 'dir_width': (ux, uy), 'center': center}


# ---------------------------------------------------------------- 3D OBB панели

def obb_from_points(points, normal):
    """OBB для плоской детали: normal — ось толщины (нормаль самой большой плоской грани),
    в плоскости — прямоугольник минимальной площади.

    Возвращает dict: length, width, thickness, dir_length, dir_width, dir_thickness (3D единичные), center.
    """
    if not points:
        return None
    n = v_norm(normal)
    if v_len(n) < _EPS:
        return None
    u, v = basis_from_normal(n)
    flat = [(v_dot(p, u), v_dot(p, v)) for p in points]
    rect = min_area_rect(flat)
    if rect is None:
        return None
    heights = [v_dot(p, n) for p in points]
    thickness = max(heights) - min(heights)
    lu, lv = rect['dir_length']
    wu, wv = rect['dir_width']
    dir_length = v_norm(v_add(v_scale(u, lu), v_scale(v, lv)))
    dir_width = v_norm(v_add(v_scale(u, wu), v_scale(v, wv)))
    cx, cy = rect['center']
    cz = (max(heights) + min(heights)) / 2.0
    center = v_add(v_add(v_scale(u, cx), v_scale(v, cy)), v_scale(n, cz))
    return {
        'length': rect['length'], 'width': rect['width'], 'thickness': thickness,
        'dir_length': dir_length, 'dir_width': dir_width, 'dir_thickness': n, 'center': center,
    }


def aabb_from_points(points):
    """Осевой габарит (запасной путь, когда нормаль грани неизвестна)."""
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    dims = sorted([max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)], reverse=True)
    return {'length': dims[0], 'width': dims[1], 'thickness': dims[2],
            'center': ((max(xs) + min(xs)) / 2.0, (max(ys) + min(ys)) / 2.0, (max(zs) + min(zs)) / 2.0)}


def sorted_dims(length, width, thickness):
    return tuple(sorted([float(length), float(width), float(thickness)], reverse=True))


# ---------------------------------------------------------------- дубли

def signature(volume, area, face_count, dims):
    """Сигнатура детали для поиска геометрических дублей. dims — (Д, Ш, Т) отсортированные по убыванию."""
    return {'volume': float(volume), 'area': float(area), 'faces': int(face_count),
            'dims': tuple(float(d) for d in dims)}


def signatures_equal(a, b, tol=0.01, rel_tol=1e-4):
    """tol — абсолютный допуск на габариты (мм); rel_tol — относительный допуск на объём и площадь."""
    if a['faces'] != b['faces']:
        return False
    if len(a['dims']) != len(b['dims']):
        return False
    for da, db in zip(a['dims'], b['dims']):
        if abs(da - db) > tol:
            return False
    for key in ('volume', 'area'):
        ref = max(abs(a[key]), abs(b[key]), _EPS)
        if abs(a[key] - b[key]) > rel_tol * ref:
            return False
    return True


def group_duplicates(items, tol=0.01, rel_tol=1e-4):
    """items: список (key, signature). Возвращает список групп (списки key, длиной >= 2).
    Порядок групп — по первому появлению; ключ-эталон группы — первый."""
    groups = []
    assigned = set()
    for i, (key_i, sig_i) in enumerate(items):
        if key_i in assigned:
            continue
        group = [key_i]
        for key_j, sig_j in items[i + 1:]:
            if key_j in assigned:
                continue
            if signatures_equal(sig_i, sig_j, tol, rel_tol):
                group.append(key_j)
                assigned.add(key_j)
        if len(group) > 1:
            assigned.update(group)
            groups.append(group)
    return groups


# ---------------------------------------------------------------- имена, код проекта, материалы

_DEFAULT_NAME_RE = re.compile(
    r'^(component|body|occurrence|компонент|тело|unnamed|untitled)\s*\d*(\s*\(\d+\))?$', re.IGNORECASE)


def is_default_name(name):
    """«Component1», «Body3», «Компонент 2», пустое имя — дефолтные/пустые имена."""
    text = (name or '').strip()
    if not text:
        return True
    return bool(_DEFAULT_NAME_RE.match(text))


def strip_occurrence_suffix(name):
    """«Полка:2» -> «Полка»"""
    text = name or ''
    if ':' in text:
        head, tail = text.rsplit(':', 1)
        if tail.isdigit():
            return head
    return text


_PROJECT_CODE_RE = re.compile(r'(?<![\d.-])(\d{1,5}-\d{1,3})(?![\d.-])')


def parse_project_code(document_name):
    """Ищет код вида «37-4» в имени документа. Возвращает строку или None."""
    m = _PROJECT_CODE_RE.search(document_name or '')
    return m.group(1) if m else None


def find_material(material_name, reference):
    """Возвращает запись справочника, к которой относится материал Fusion, или None."""
    text = (material_name or '').lower()
    if not text:
        return None
    for entry in reference or []:
        for pattern in entry.get('patterns', []):
            if pattern.lower() in text:
                return entry
    return None


def has_prefix(name, prefixes):
    text = (name or '').lower()
    return any(text.startswith(str(p).lower()) for p in prefixes or [] if p)


def matches_keywords(text, keywords):
    low = (text or '').lower()
    return any(str(k).lower() in low for k in keywords or [] if k)
