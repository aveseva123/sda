# -*- coding: utf-8 -*-
"""Обёртки над Fusion 360 API. Координаты в вызовах — мм в мировой системе, внутри API — см."""
import math
import os
import re
import adsk.core
import adsk.fusion

NEW = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
JOIN = adsk.fusion.FeatureOperations.JoinFeatureOperation
CUT = adsk.fusion.FeatureOperations.CutFeatureOperation

FLAT_SKETCHES = []   # (имя, эскиз) плоских деталей под DXF для лазера


def mm(v):
    return v / 10.0


def vi(v_mm):
    return adsk.core.ValueInput.createByReal(mm(v_mm))


def pt(x, y, z=0.0):
    return adsk.core.Point3D.create(mm(x), mm(y), mm(z))


def vec(x, y, z):
    return adsk.core.Vector3D.create(x, y, z)


def items(coll):
    return [coll.item(i) for i in range(coll.count)]


class Ctx:
    def __init__(self):
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.design = adsk.fusion.Design.cast(self.app.activeProduct)
        if not self.design:
            raise RuntimeError('Откройте документ Fusion в рабочем пространстве Design.')
        self.root = self.design.rootComponent


def new_component(parent, name):
    occ = parent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ.component.name = name
    return occ.component


_BASE = {'x': 'yZConstructionPlane', 'y': 'xZConstructionPlane', 'z': 'xYConstructionPlane'}


def plane_at(comp, axis, value_mm):
    """Плоскость, перпендикулярная оси axis, на координате value_mm (учитывает знак нормали базовой плоскости)."""
    base = getattr(comp, _BASE[axis])
    if abs(value_mm) < 1e-9:
        return base
    n = base.geometry.normal
    s = {'x': n.x, 'y': n.y, 'z': n.z}[axis]
    s = 1.0 if s >= 0 else -1.0
    planes = comp.constructionPlanes
    inp = planes.createInput()
    inp.setByOffset(base, vi(value_mm * s))
    pl = planes.add(inp)
    pl.isLightBulbOn = False
    return pl


def sketch(comp, plane, name=None):
    sk = comp.sketches.add(plane)
    if name:
        sk.name = name
    return sk


def sp(sk, x, y, z):
    """Мировая точка (мм) → координаты эскиза."""
    return sk.modelToSketchSpace(pt(x, y, z))


def rect(sk, p1, p2):
    return sk.sketchCurves.sketchLines.addTwoPointRectangle(sp(sk, *p1), sp(sk, *p2))


def circle(sk, c, r):
    return sk.sketchCurves.sketchCircles.addByCenterRadius(sp(sk, *c), mm(r))


def polygon(sk, pts):
    lines = sk.sketchCurves.sketchLines
    n = len(pts)
    for i in range(n):
        lines.addByTwoPoints(sp(sk, *pts[i]), sp(sk, *pts[(i + 1) % n]))


def compose(axis, u, v, a):
    """(u, v) в плоскости, перпендикулярной axis, плюс координата a по оси → мировая точка."""
    return {'x': (a, u, v), 'y': (u, a, v), 'z': (u, v, a)}[axis]


def prof_largest(sk):
    return max(items(sk.profiles), key=lambda p: p.areaProperties().area)


def prof_loops(sk, n):
    for p in items(sk.profiles):
        if p.profileLoops.count == n:
            return p
    raise RuntimeError('Нет профиля с %d контурами в эскизе %s' % (n, sk.name))


def named(feat, name):
    if name and feat.bodies.count:
        feat.bodies.item(0).name = name
    return feat


def extrude_sym(comp, profile, length_mm, op=NEW, participants=None):
    """Симметричное выдавливание на полную длину — не зависит от направления нормали эскиза."""
    feats = comp.features.extrudeFeatures
    inp = feats.createInput(profile, op)
    inp.setSymmetricExtent(vi(length_mm), True)
    if participants:
        inp.participantBodies = list(participants)
    return feats.add(inp)


def box(comp, p1, p2, name=None, op=NEW, participants=None, flat=False):
    """Параллелепипед по двум противоположным углам (мм)."""
    x1, y1, z1 = p1
    x2, y2, z2 = p2
    zm = (z1 + z2) / 2.0
    sk = sketch(comp, plane_at(comp, 'z', zm), name)
    rect(sk, (x1, y1, zm), (x2, y2, zm))
    if flat and name:
        FLAT_SKETCHES.append((name, sk))
    return named(extrude_sym(comp, sk.profiles.item(0), abs(z2 - z1), op, participants), name)


def cylinder(comp, axis, uv, r, a1, a2, name=None, op=NEW, participants=None, r_in=None, flat=False):
    """Цилиндр (или кольцо при r_in) вдоль оси axis от a1 до a2; uv — центр в поперечной плоскости."""
    am = (a1 + a2) / 2.0
    sk = sketch(comp, plane_at(comp, axis, am), name)
    c = compose(axis, uv[0], uv[1], am)
    circle(sk, c, r)
    if r_in:
        circle(sk, c, r_in)
        prof = prof_loops(sk, 2)
    else:
        prof = sk.profiles.item(0)
    if flat and name:
        FLAT_SKETCHES.append((name, sk))
    return named(extrude_sym(comp, prof, abs(a2 - a1), op, participants), name)


def square_tube(comp, axis, uv, size, t, a1, a2, name=None):
    am = (a1 + a2) / 2.0
    sk = sketch(comp, plane_at(comp, axis, am), name)
    u, v = uv
    h = size / 2.0
    rect(sk, compose(axis, u - h, v - h, am), compose(axis, u + h, v + h, am))
    rect(sk, compose(axis, u - h + t, v - h + t, am), compose(axis, u + h - t, v + h - t, am))
    return named(extrude_sym(comp, prof_loops(sk, 2), abs(a2 - a1), NEW), name)


def u_channel(comp, axis, u0, v_floor, width_in, wall_h, t, a1, a2, name=None):
    """Швеллер-лоток: дно и два борта. Открыт вверх (+v). Ось лотка — axis, центр по u = u0."""
    am = (a1 + a2) / 2.0
    sk = sketch(comp, plane_at(comp, axis, am), name)
    wo = width_in / 2.0 + t
    wi = width_in / 2.0
    pts = [
        (u0 - wo, v_floor - t), (u0 + wo, v_floor - t), (u0 + wo, v_floor + wall_h),
        (u0 + wi, v_floor + wall_h), (u0 + wi, v_floor), (u0 - wi, v_floor),
        (u0 - wi, v_floor + wall_h), (u0 - wo, v_floor + wall_h),
    ]
    polygon(sk, [compose(axis, u, v, am) for u, v in pts])
    return named(extrude_sym(comp, sk.profiles.item(0), abs(a2 - a1), NEW), name)


def loft(comp, profiles, op=NEW, name=None):
    feats = comp.features.loftFeatures
    inp = feats.createInput(op)
    for p in profiles:
        inp.loftSections.add(p)
    inp.isSolid = True
    return named(feats.add(inp), name)


def planar_faces_by_z(body):
    faces = [f for f in items(body.faces)
             if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType]
    return sorted(faces, key=lambda f: f.pointOnFace.z)


def shell(comp, body, faces, t_mm):
    coll = adsk.core.ObjectCollection.create()
    for f in faces:
        coll.add(f)
    feats = comp.features.shellFeatures
    inp = feats.createInput(coll, False)
    inp.insideThickness = vi(t_mm)
    return feats.add(inp)


def frustum_shell(comp, z_bot, bot_rect, z_top, top_rect, t, name, open_top=True, open_bottom=True):
    """Воронка/бункер: лофт между двумя прямоугольниками и оболочка толщиной t.
    bot_rect/top_rect = (cx, cy, size_x, size_y)."""
    def rect_profile(z, r):
        cx, cy, sx, sy = r
        sk = sketch(comp, plane_at(comp, 'z', z))
        rect(sk, (cx - sx / 2.0, cy - sy / 2.0, z), (cx + sx / 2.0, cy + sy / 2.0, z))
        return sk.profiles.item(0)
    feat = loft(comp, [rect_profile(z_bot, bot_rect), rect_profile(z_top, top_rect)], NEW, name)
    body = feat.bodies.item(0)
    faces = planar_faces_by_z(body)
    remove = []
    if open_bottom:
        remove.append(faces[0])
    if open_top:
        remove.append(faces[-1])
    shell(comp, body, remove, t)
    return body


def rotate_bodies(comp, bodies, angle_deg, axis_xyz, origin_xyz):
    m = adsk.core.Matrix3D.create()
    m.setToRotation(math.radians(angle_deg), vec(*axis_xyz), pt(*origin_xyz))
    coll = adsk.core.ObjectCollection.create()
    for b in bodies:
        coll.add(b)
    feats = comp.features.moveFeatures
    inp = feats.createInput(coll, m)
    return feats.add(inp)


def helix_track(comp, cx, cy, r_out, width, t, z0, turns, pitch, name):
    """Спиральная дорожка: сплайн по точкам винтовой линии + протяжка прямоугольного сечения."""
    r_c = r_out - width / 2.0
    sk = sketch(comp, comp.xYConstructionPlane, name + ' — путь')
    pts = adsk.core.ObjectCollection.create()
    steps = int(round(turns * 36))
    for i in range(steps + 1):
        a = 2 * math.pi * i / 36.0
        pts.add(sp(sk, cx + r_c * math.cos(a), cy + r_c * math.sin(a), z0 + pitch * a / (2 * math.pi)))
    spline = sk.sketchCurves.sketchFittedSplines.add(pts)
    path = comp.features.createPath(spline, False)
    sk2 = sketch(comp, plane_at(comp, 'y', cy), name + ' — сечение')
    rect(sk2, (cx + r_out - width, cy, z0), (cx + r_out, cy, z0 + t))
    feats = comp.features.sweepFeatures
    inp = feats.createInput(sk2.profiles.item(0), path, NEW)
    inp.orientation = adsk.fusion.SweepOrientationTypes.PerpendicularOrientationType
    return named(feats.add(inp), name)


def safe_name(s):
    return re.sub(r'[^\w\-]+', '_', s, flags=re.UNICODE).strip('_')


def export_dxf(ctx, folder):
    os.makedirs(folder, exist_ok=True)
    em = ctx.design.exportManager
    done = []
    for name, sk in FLAT_SKETCHES:
        path = os.path.join(folder, safe_name(name) + '.dxf')
        opts = em.createDXF2DExportOptions(path, sk)
        em.execute(opts)
        done.append(path)
    return done
