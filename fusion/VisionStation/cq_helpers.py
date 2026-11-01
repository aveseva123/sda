# -*- coding: utf-8 -*-
"""Замена helpers.py для сборки той же модели в CadQuery (без Fusion). Те же сигнатуры, что у helpers.py.

Геометрия собирается в PARTS: (компонент, имя тела, cq.Shape). Используется cad_model.py.
"""
import cadquery as cq

NEW, JOIN, CUT = 'new', 'join', 'cut'
FLAT_SKETCHES = []
PARTS = []            # list of dicts: comp, name, shape


class _Body:
    def __init__(self, idx):
        self.idx = idx


class _Feat:
    def __init__(self, idx):
        self._idx = idx

    @property
    def bodies(self):
        feat = self

        class _B:
            count = 1

            def item(self, i):
                return _Body(feat._idx)
        return _B()


class _Comp:
    def __init__(self, name):
        self.name = name


def new_component(parent, name):
    return _Comp(name)


def _add(comp, name, shape, op=NEW, participants=None):
    if op == CUT and participants:
        for b in participants:
            PARTS[b.idx]['shape'] = PARTS[b.idx]['shape'].cut(shape)
        return _Feat(participants[0].idx)
    PARTS.append({'comp': comp.name, 'name': name or 'тело', 'shape': shape})
    return _Feat(len(PARTS) - 1)


def _box(x1, y1, z1, x2, y2, z2):
    lo = (min(x1, x2), min(y1, y2), min(z1, z2))
    hi = (max(x1, x2), max(y1, y2), max(z1, z2))
    return cq.Solid.makeBox(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], cq.Vector(*lo))


def box(comp, p1, p2, name=None, op=NEW, participants=None, flat=False):
    return _add(comp, name, _box(*p1, *p2), op, participants)


_AXIS = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}


def compose(axis, u, v, a):
    return {'x': (a, u, v), 'y': (u, a, v), 'z': (u, v, a)}[axis]


def cylinder(comp, axis, uv, r, a1, a2, name=None, op=NEW, participants=None, r_in=None, flat=False):
    lo, hi = min(a1, a2), max(a1, a2)
    pnt = cq.Vector(*compose(axis, uv[0], uv[1], lo))
    d = cq.Vector(*_AXIS[axis])
    s = cq.Solid.makeCylinder(r, hi - lo, pnt, d)
    if r_in:
        s = s.cut(cq.Solid.makeCylinder(r_in, hi - lo, pnt, d))
    return _add(comp, name, s, op, participants)


def _box_axis(axis, u1, v1, u2, v2, a1, a2):
    p1 = compose(axis, u1, v1, a1)
    p2 = compose(axis, u2, v2, a2)
    return _box(*p1, *p2)


def square_tube(comp, axis, uv, size, t, a1, a2, name=None):
    u, v = uv
    h = size / 2.0
    s = _box_axis(axis, u - h, v - h, u + h, v + h, a1, a2).cut(
        _box_axis(axis, u - h + t, v - h + t, u + h - t, v + h - t, a1 - 1, a2 + 1))
    return _add(comp, name, s)


def u_channel(comp, axis, u0, v_floor, width_in, wall_h, t, a1, a2, name=None):
    wo, wi = width_in / 2.0 + t, width_in / 2.0
    s = _box_axis(axis, u0 - wo, v_floor - t, u0 + wo, v_floor + wall_h, a1, a2).cut(
        _box_axis(axis, u0 - wi, v_floor, u0 + wi, v_floor + wall_h + 1, a1 - 1, a2 + 1))
    return _add(comp, name, s)


def frustum_shell(comp, z_bot, bot_rect, z_top, top_rect, t, name, open_top=True, open_bottom=True):
    cx1, cy1, sx1, sy1 = bot_rect
    cx2, cy2, sx2, sy2 = top_rect
    wp = (cq.Workplane('XY').workplane(offset=z_bot).center(cx1, cy1).rect(sx1, sy1)
          .workplane(offset=z_top - z_bot).center(cx2 - cx1, cy2 - cy1).rect(sx2, sy2).loft())
    sel = ' or '.join(s for s, on in (('>Z', open_top), ('<Z', open_bottom)) if on)
    shape = wp.faces(sel).shell(-t).val() if sel else wp.val()
    _add(comp, name, shape)
    return _Body(len(PARTS) - 1)


def planar_faces_by_z(body):
    return [None, body]


def shell(comp, body, faces, t_mm):
    """Используется только для открытия верхней грани (ковш, ящик)."""
    shape = PARTS[body.idx]['shape']
    PARTS[body.idx]['shape'] = cq.Workplane('XY').add(shape).faces('>Z').shell(-t_mm).val()


def rotate_bodies(comp, bodies, angle_deg, axis_xyz, origin_xyz):
    o = cq.Vector(*origin_xyz)
    e = o + cq.Vector(*axis_xyz)
    for b in bodies:
        PARTS[b.idx]['shape'] = PARTS[b.idx]['shape'].rotate(o, e, angle_deg)


def helix_track(comp, cx, cy, r_out, width, t, z0, turns, pitch, name):
    r_c = r_out - width / 2.0
    path = cq.Workplane('XY').parametricCurve(
        lambda u: (cx + r_c * __import__('math').cos(2 * __import__('math').pi * turns * u),
                   cy + r_c * __import__('math').sin(2 * __import__('math').pi * turns * u),
                   z0 + pitch * turns * u), N=int(turns * 36), makeWire=True)
    prof = cq.Workplane('XZ', origin=(0, cy, 0)).center(cx + r_out - width / 2.0, z0 + t / 2.0).rect(width, t)
    s = prof.sweep(path, isFrenet=True).val()
    return _add(comp, name, s)


# ---------- расширение для детализации: призмы, кабели, объединение ----------
import math as _m


def _add_op(comp, name, shape, op=NEW, participants=None):
    if op == JOIN and participants:
        b = participants[0]
        PARTS[b.idx]['shape'] = PARTS[b.idx]['shape'].fuse(shape)
        return _Feat(b.idx)
    return _add(comp, name, shape, op, participants)


def poly_prism(comp, axis, pts, a1, a2, name=None, op=NEW, participants=None):
    """Призма с произвольным многоугольником (u, v) в плоскости, перпендикулярной axis, от a1 до a2."""
    lo, hi = min(a1, a2), max(a1, a2)
    verts = [cq.Vector(*compose(axis, u, v, lo)) for u, v in pts]
    wire = cq.Wire.makePolygon(verts + [verts[0]])
    solid = cq.Solid.extrudeLinear(wire, [], cq.Vector(*_AXIS[axis]) * (hi - lo))
    return _add_op(comp, name, solid, op, participants)


def prism(comp, axis, uv, n, r, a1, a2, name=None, rot=0.0, op=NEW, participants=None):
    """Правильная n-угольная призма (шестигранник болта и т. п.), r — радиус описанной окружности."""
    pts = [(uv[0] + r * _m.cos(rot + 2 * _m.pi * i / n), uv[1] + r * _m.sin(rot + 2 * _m.pi * i / n)) for i in range(n)]
    return poly_prism(comp, axis, pts, a1, a2, name, op, participants)


def tube_path(comp, pts, r, name=None):
    """Кабель/трубка: круг радиуса r протянут по сплайну через точки (мм)."""
    p0, p1 = cq.Vector(*pts[0]), cq.Vector(*pts[1])
    path = cq.Workplane('XY').spline([tuple(p) for p in pts], includeCurrent=False)
    plane = cq.Plane(origin=p0, normal=(p1 - p0).normalized())
    solid = cq.Workplane(plane).circle(r).sweep(path, isFrenet=True).val()
    return _add(comp, name, solid)


def cylinder_join(comp, axis, uv, r, a1, a2, body):
    lo, hi = min(a1, a2), max(a1, a2)
    s = cq.Solid.makeCylinder(r, hi - lo, cq.Vector(*compose(axis, uv[0], uv[1], lo)), cq.Vector(*_AXIS[axis]))
    return _add_op(comp, None, s, JOIN, [body])


def cable_poly(comp, pts, r, name=None):
    """Провод по ломаной с круглыми изгибами (одно тело). Повторы точек и слишком короткие
    отрезки убираются; если протяжка не строится, провод собирается из цилиндров и шариков."""
    verts = []
    for p in pts:
        v = cq.Vector(*p)
        if not verts or (v - verts[-1]).Length > max(1.0, 1.2 * r):
            verts.append(v)
    if len(verts) < 2:
        raise ValueError('кабель %s: меньше двух точек' % name)
    try:
        wire = cq.Wire.makePolygon(verts)
        plane = cq.Plane(origin=verts[0], normal=(verts[1] - verts[0]).normalized())
        solid = cq.Workplane(plane).circle(r).sweep(cq.Workplane('XY').add(wire), transition='round').val()
        if not solid.isValid():
            raise ValueError('invalid sweep')
    except Exception:
        parts = []
        for a, b in zip(verts[:-1], verts[1:]):
            parts.append(cq.Solid.makeCylinder(r, (b - a).Length, a, (b - a).normalized()))
        for v in verts[1:-1]:
            parts.append(cq.Solid.makeSphere(r, v))
        solid = cq.Compound.makeCompound(parts)
    return _add(comp, name, solid)
