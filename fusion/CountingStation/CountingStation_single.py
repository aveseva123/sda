# -*- coding: utf-8 -*-
"""Счётная станция линии фасовки метизов — скрипт Fusion 360 в одном файле.

Строит параметрическую сборку прототипа станции (этап 2 ТЗ): рама стенда, вибропривод,
чаша Ø300 со спиральной дорожкой и выходным лотком, счётная зона со стоп-штифтом,
накопитель с перекидной заслонкой, стендовые весы, бункер-дозагрузчик с вибролотком.

Запуск: Fusion 360 → Utilities → Scripts and Add-Ins → Scripts → «+» → папка с этим файлом → Run.
Размеры — в словаре P ниже. Повторный запуск строит новую сборку рядом со старой.
Собрано из params.py, helpers.py, station.py, CountingStation.py (modular-версия в той же папке репозитория).
"""
import math
import os
import re
import traceback

import adsk.core
import adsk.fusion

EXPORT_DXF = False          # True — выгрузить эскизы плоских деталей в out/dxf рядом со скриптом
HERE = os.path.dirname(os.path.abspath(__file__))


# ============================ ПАРАМЕТРЫ ============================
"""Параметры счётной станции (прототип, чаша Ø300). Все размеры в мм, углы в градусах.

Меняете значения здесь и запускаете скрипт заново — он строит новую сборку.
Источник требований: ТЗ «Линия счёта и фасовки метизов», раздел «Счётная станция».
"""

P = dict(
    # --- деталь (для отсекателя и зазоров)
    part_h_max=10,          # максимальная высота детали, лежащей на дорожке

    # --- виброчаша
    bowl_d=300,             # наружный диаметр чаши
    bowl_h=120,             # высота стенки
    bowl_t=1.5,             # толщина стенки, AISI 304
    bowl_bottom_t=2,        # толщина дна
    track_w=25,             # ширина спиральной дорожки
    track_t=2,              # толщина полосы дорожки
    track_turns=2,          # число витков
    track_pitch=40,         # подъём за виток
    track_z0=2,             # зазор первого витка над дном
    exit_len=120,           # длина выходного лотка от стенки чаши
    exit_w=25,              # внутренняя ширина лотка
    exit_wall_h=20,         # высота бортов лотка
    exit_t=2,               # толщина листа лотка

    # --- вибропривод (электромагнитный)
    top_plate_d=300, top_plate_t=12,            # верхняя плита под чашу
    counter_mass_d=320, counter_mass_t=40,      # плита-противомасса, сталь
    spring_len=122, spring_w=50, spring_t=1.5,  # лист плоской пружины
    spring_leaves=3, spring_packs=3,            # листов в пакете, пакетов
    spring_r=130,                               # радиус установки пакетов
    spring_tilt=20,                             # наклон пакета от вертикали
    clamp_h=12.5, clamp_w=60, clamp_d=20,       # прижимные колодки пружин
    magnet_w=100, magnet_d=60, magnet_h=103,    # электромагнит с катушкой
    armature_t=10, air_gap=2,                   # якорь и рабочий зазор
    isolator_d=40, isolator_h=30, isolator_r=120,   # резиновые виброопоры

    # --- стенд (рама прототипа)
    frame_w=600, frame_l=900, frame_cy=-50,     # плита стенда и её центр по Y
    frame_top_z=600,                            # верх плиты стенда от пола
    plate_t=5, tube=40, tube_t=2, brace_z=150,  # лист плиты, профтруба 40×40×2
    foot_d=60, foot_h=8,                        # регулируемые опоры

    # --- счётная зона и стоп-штифт
    sensor_drop=20,         # луч датчика ниже кромки лотка
    pin_cyl_d=16, pin_cyl_len=50, pin_rod_d=4,  # пневмоцилиндр Ø10 (корпус Ø16)

    # --- накопитель
    funnel_top_x=120, funnel_top_y=80, funnel_out=40, funnel_h=100, funnel_t=1,
    flap_box_x=44, flap_box_y=120, flap_box_z=60, flap_t=1.5,
    flap_cyl_d=16, flap_cyl_len=80,

    # --- стендовые весы и ящик возврата
    cup_d=60, cup_h=35, platform=120, platform_t=3,
    cell_l=130, cell_w=30, cell_h=22,
    bin_x=100, bin_y=100, bin_z=60, bin_t=1,

    # --- бункер-дозагрузчик 10 л и вибролоток
    hopper_top_x=300, hopper_bot_x=60, hopper_y=250, hopper_h=250, hopper_t=1.5,
    hopper_cy=-255,                             # центр бункера по Y
    tray_w=80, tray_wall=40, tray_t=1.5, tray_y1=-400, tray_y2=-30,
    tray_drop=30,                               # дно лотка выше кромки чаши
    feeder_x=90, feeder_y=150, feeder_h=70,     # линейный вибропитатель
    arm_x=320, arm_y=160, arm_t=6,              # плита стойки бункера
    post_y=-330,                                # стойка 40×40 бункера
    bar_w=40, bar_t=5,                          # полоса кронштейна бункера

    # --- датчик уровня
    level_d=18, level_len=60, level_xy=(-100, 60),
)


def layout(p=P):
    """Высотные отметки (мм от пола), выведенные из параметров."""
    L = {}
    L['z_plate_top'] = p['frame_top_z']
    L['z_mass_bot'] = L['z_plate_top'] + p['isolator_h']
    L['z_mass_top'] = L['z_mass_bot'] + p['counter_mass_t']
    L['z_top_plate_bot'] = L['z_mass_top'] + p['spring_len'] * math.cos(math.radians(p['spring_tilt']))
    L['z_top_plate_top'] = L['z_top_plate_bot'] + p['top_plate_t']
    L['z_bowl_floor'] = L['z_top_plate_top'] + p['bowl_bottom_t']
    L['z_rim'] = L['z_bowl_floor'] + p['bowl_h']
    L['z_track_exit'] = L['z_bowl_floor'] + p['track_z0'] + p['track_t'] + p['track_turns'] * p['track_pitch']
    L['r_in'] = p['bowl_d'] / 2 - p['bowl_t']
    L['x_exit'] = L['r_in'] - p['track_w'] / 2          # ось выходного лотка
    L['y_sensor'] = p['exit_len'] + 15
    L['z_sensor'] = L['z_track_exit'] - p['sensor_drop']
    L['z_funnel_top'] = L['z_sensor'] - 32
    L['z_funnel_bot'] = L['z_funnel_top'] - p['funnel_h']
    L['z_flap_bot'] = L['z_funnel_bot'] - p['flap_box_z']
    L['z_tray_floor'] = L['z_rim'] + p['tray_drop']
    L['z_arm_top'] = L['z_tray_floor'] - p['feeder_h']
    L['z_hopper_bot'] = L['z_tray_floor'] + p['tray_t'] + p['tray_wall'] + 5
    return L


# ============================ ОБЁРТКИ API ============================
"""Обёртки над Fusion 360 API. Координаты в вызовах — мм в мировой системе, внутри API — см."""

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


# ============================ УЗЛЫ ============================
"""Построители узлов счётной станции. Каждый узел — свой компонент, геометрия в мировых координатах (мм).

Система координат: ось чаши — начало координат, Z вверх, пол на Z=0.
Выход дорожки — на +X, выходной лоток идёт вдоль +Y, бункер и вибролоток — со стороны −Y.
"""


def build_frame(ctx, parent, P, L):
    c = new_component(parent, 'Рама стенда')
    cx, cy = 0.0, P['frame_cy']
    w, l, tube, t = P['frame_w'], P['frame_l'], P['tube'], P['tube_t']
    zt = L['z_plate_top']
    box(c, (cx - w / 2, cy - l / 2, zt - P['plate_t']), (cx + w / 2, cy + l / 2, zt),
        'Плита стенда — сталь %g' % P['plate_t'], flat=True)
    ins = tube / 2 + 10
    legs = [(cx + sx * (w / 2 - ins), cy + sy * (l / 2 - ins)) for sx in (-1, 1) for sy in (-1, 1)]
    for i, (x, y) in enumerate(legs):
        square_tube(c, 'z', (x, y), tube, t, P['foot_h'], zt - P['plate_t'],
                    'Ножка %d — профтруба %g×%g×%g' % (i + 1, tube, tube, t))
        cylinder(c, 'z', (x, y), P['foot_d'] / 2, 0, P['foot_h'], 'Опора регулируемая M12 №%d' % (i + 1))
    zb = P['brace_z']
    xs = sorted(set(x for x, _ in legs))
    ys = sorted(set(y for _, y in legs))
    for y in ys:
        square_tube(c, 'x', (y, zb), tube, t, xs[0] + tube / 2, xs[1] - tube / 2, 'Поперечина вдоль X')
    for x in xs:
        square_tube(c, 'y', (x, zb), tube, t, ys[0] + tube / 2, ys[1] - tube / 2, 'Поперечина вдоль Y')
    return c


def build_drive(ctx, parent, P, L):
    c = new_component(parent, 'Вибропривод чаши')
    for i in range(4):
        a = math.radians(45 + 90 * i)
        cylinder(c, 'z', (P['isolator_r'] * math.cos(a), P['isolator_r'] * math.sin(a)),
                 P['isolator_d'] / 2, L['z_plate_top'], L['z_mass_bot'],
                 'Виброопора резиновая Ø%g×%g №%d' % (P['isolator_d'], P['isolator_h'], i + 1))
    cylinder(c, 'z', (0, 0), P['counter_mass_d'] / 2, L['z_mass_bot'], L['z_mass_top'],
             'Противомасса — сталь Ø%g×%g' % (P['counter_mass_d'], P['counter_mass_t']))
    mw, md, mh = P['magnet_w'], P['magnet_d'], P['magnet_h']
    box(c, (-mw / 2, -md / 2, L['z_mass_top']), (mw / 2, md / 2, L['z_mass_top'] + mh),
        'Электромагнит с катушкой (покупной)')
    za = L['z_top_plate_bot'] - P['armature_t']
    box(c, (-mw / 2, -md / 2, za), (mw / 2, md / 2, L['z_top_plate_bot']), 'Якорь — сталь %g' % P['armature_t'])
    cylinder(c, 'z', (0, 0), P['top_plate_d'] / 2, L['z_top_plate_bot'], L['z_top_plate_top'],
             'Верхняя плита — сталь Ø%g×%g' % (P['top_plate_d'], P['top_plate_t']))

    r, n, t, w, Lsp = P['spring_r'], P['spring_leaves'], P['spring_t'], P['spring_w'], P['spring_len']
    z0 = L['z_mass_top']
    cd, cw, ch = P['clamp_d'], P['clamp_w'], P['clamp_h']
    for k in range(P['spring_packs']):
        theta = 90 + 360.0 * k / P['spring_packs']
        bodies = []
        x0 = r - n * t / 2.0
        for j in range(n):
            f = box(c, (x0 + j * t, -w / 2, z0), (x0 + (j + 1) * t, w / 2, z0 + Lsp),
                    'Пружина плоская — пакет %d лист %d — 65Г %g' % (k + 1, j + 1, t))
            bodies.append(f.bodies.item(0))
        for z1, nm in ((z0, 'нижняя'), (z0 + Lsp - ch, 'верхняя')):
            for xa, xb, side in ((x0 - cd / 2, x0, 'А'), (x0 + n * t, x0 + n * t + cd / 2, 'Б')):
                f = box(c, (xa, -cw / 2, z1), (xb, cw / 2, z1 + ch),
                        'Колодка %s пакет %d %s — сталь' % (nm, k + 1, side))
                bodies.append(f.bodies.item(0))
        rotate_bodies(c, bodies, P['spring_tilt'], (0, 1, 0), (r, 0, z0))   # наклон вокруг касательной
        rotate_bodies(c, bodies, theta, (0, 0, 1), (0, 0, 0))              # расстановка по окружности
    return c


def build_bowl(ctx, parent, P, L):
    c = new_component(parent, 'Виброчаша Ø%g' % P['bowl_d'])
    R, r_in = P['bowl_d'] / 2.0, L['r_in']
    zb, zf, zte = L['z_top_plate_top'], L['z_bowl_floor'], L['z_track_exit']
    cylinder(c, 'z', (0, 0), R, zb, zf, 'Дно чаши — AISI 304 %g' % P['bowl_bottom_t'], flat=True)
    wall = cylinder(c, 'z', (0, 0), R, zf, L['z_rim'], 'Стенка чаши — AISI 304 %g' % P['bowl_t'],
                    r_in=r_in).bodies.item(0)
    helix_track(c, 0, 0, r_in + 0.5, P['track_w'], P['track_t'], zf + P['track_z0'],
                P['track_turns'], P['track_pitch'], 'Дорожка спиральная — AISI 304 %g' % P['track_t'])
    xe = L['x_exit']
    x_in_edge = xe - P['exit_w'] / 2 - P['exit_t']
    y_win = math.sqrt(max(R ** 2 - x_in_edge ** 2, 0.0)) + 2
    box(c, (xe - P['track_w'], -5, zte - P['exit_t'] - 1), (R + 2, y_win, zte + P['exit_wall_h'] + 5),
        None, CUT, [wall])
    chute = u_channel(c, 'y', xe, zte, P['exit_w'], P['exit_wall_h'], P['exit_t'], 0, P['exit_len'],
                      'Лоток выходной — AISI 304 %g' % P['exit_t']).bodies.item(0)
    zw = zte + P['part_h_max'] * 1.2
    box(c, (xe - P['track_w'] / 2 - 2, -28, zw), (R, -12, zw + 1.5), 'Отсекатель — AISI 304 1.5', flat=True)
    return {'component': c, 'chute': chute}


def build_counter(ctx, parent, P, L, chute_body):
    c = new_component(parent, 'Счёт и стоп-штифт')
    xe, zte = L['x_exit'], L['z_track_exit']
    y_pin, z_pin = P['exit_len'] - 25, zte + 8
    x_out = xe + P['exit_w'] / 2 + P['exit_t']
    cylinder(c, 'x', (y_pin, z_pin), P['pin_cyl_d'] / 2, x_out + 3, x_out + 3 + P['pin_cyl_len'],
             'Пневмоцилиндр стоп-штифта Ø10×15 (покупной)')
    cylinder(c, 'x', (y_pin, z_pin), P['pin_rod_d'] / 2, xe - P['exit_w'] / 2, x_out + 3,
             'Стоп-штифт (шток) Ø%g' % P['pin_rod_d'])
    cylinder(c, 'x', (y_pin, z_pin), P['pin_rod_d'] / 2 + 0.5, xe - P['exit_w'] / 2 - P['exit_t'] - 1,
             x_out + 1, None, CUT, [chute_body])
    box(c, (x_out, y_pin - 15, zte - P['exit_t']), (x_out + 2, y_pin + 15, zte + P['exit_wall_h']),
        'Кронштейн цилиндра — AISI 304 2', flat=True)
    ys, zs = L['y_sensor'], L['z_sensor']
    for s, nm in ((-1, 'излучатель'), (1, 'приёмник')):
        cylinder(c, 'x', (ys, zs), 1.5, xe + s * 22, xe + s * 42, 'Оптоволокно — %s Ø3 (покупной)' % nm)
    box(c, (xe - 40, ys - 10, zs - 30), (xe + 40, ys + 10, zs - 28.5), 'Скоба датчика — основание AISI 304 1.5', flat=True)
    box(c, (xe - 40, ys - 10, zs - 30), (xe - 38.5, ys + 10, zs + 10), 'Скоба датчика — стойка А')
    box(c, (xe + 38.5, ys - 10, zs - 30), (xe + 40, ys + 10, zs + 10), 'Скоба датчика — стойка Б')
    return c


def build_accumulator(ctx, parent, P, L):
    c = new_component(parent, 'Накопитель с заслонкой')
    xe, ys = L['x_exit'], L['y_sensor']
    zt, zb = L['z_funnel_top'], L['z_funnel_bot']
    frustum_shell(c, zb, (xe, ys, P['funnel_out'], P['funnel_out']), zt,
                  (xe, ys, P['funnel_top_x'], P['funnel_top_y']), P['funnel_t'],
                  'Воронка — AISI 304 %g' % P['funnel_t'])
    bx, by, t = P['flap_box_x'], P['flap_box_y'], P['flap_t']
    z1, z2 = L['z_flap_bot'], zb
    box(c, (xe - bx / 2, ys - by / 2, z1), (xe - bx / 2 + t, ys + by / 2, z2), 'Корпус заслонки — стенка А AISI 304 1.5', flat=True)
    box(c, (xe + bx / 2 - t, ys - by / 2, z1), (xe + bx / 2, ys + by / 2, z2), 'Корпус заслонки — стенка Б AISI 304 1.5', flat=True)
    box(c, (xe - bx / 2, ys - by / 2, z1), (xe + bx / 2, ys - by / 2 + t, z2), 'Корпус заслонки — торец А AISI 304 1.5', flat=True)
    box(c, (xe - bx / 2, ys + by / 2 - t, z1), (xe + bx / 2, ys + by / 2, z2), 'Корпус заслонки — торец Б AISI 304 1.5', flat=True)
    box(c, (xe - bx / 2 + t, ys - t / 2, z1), (xe + bx / 2 - t, ys + t / 2, z1 + 35), 'Перегородка выходов — AISI 304 1.5', flat=True)
    box(c, (xe - 20, ys - t / 2, z2 - 58), (xe + 20, ys + t / 2, z2 - 4), 'Заслонка перекидная — AISI 304 %g' % t, flat=True)
    cylinder(c, 'x', (ys, z2 - 4), 2, xe - 30, xe + 30, 'Ось заслонки Ø4')
    xc, zc = xe + bx / 2 + 10, z2 - 20
    cylinder(c, 'y', (xc, zc), P['flap_cyl_d'] / 2, ys + 10, ys + 10 + P['flap_cyl_len'],
             'Пневмоцилиндр заслонки Ø16×25 (покупной)')
    cylinder(c, 'y', (xc, zc), 3, ys - 12, ys + 10, 'Шток цилиндра заслонки')
    box(c, (xe + bx / 2 - t, ys - 14, zc - 6), (xc + 2, ys - 10, z2 - 4), 'Рычаг заслонки — сталь 4', flat=True)
    f = box(c, (xe - P['bin_x'] / 2, ys + 2, L['z_plate_top']),
            (xe + P['bin_x'] / 2, ys + 2 + P['bin_y'], L['z_plate_top'] + P['bin_z']),
            'Ящик возврата — AISI 304 %g' % P['bin_t'])
    body = f.bodies.item(0)
    shell(c, body, [planar_faces_by_z(body)[-1]], P['bin_t'])
    return c


def build_scale(ctx, parent, P, L):
    c = new_component(parent, 'Стендовые весы')
    xe, yc = L['x_exit'], L['y_sensor'] - 30
    z_cup_top = L['z_flap_bot'] - 5
    z_cup_bot = z_cup_top - P['cup_h']
    f = cylinder(c, 'z', (xe, yc), P['cup_d'] / 2, z_cup_bot, z_cup_top, 'Ковш приёмный — AISI 304 1')
    body = f.bodies.item(0)
    shell(c, body, [planar_faces_by_z(body)[-1]], 1)
    pl, ptk = P['platform'], P['platform_t']
    box(c, (xe - pl / 2, yc - pl / 2, z_cup_bot - ptk), (xe + pl / 2, yc + pl / 2, z_cup_bot),
        'Платформа весов — алюминий %g' % ptk, flat=True)
    z_cell_top = z_cup_bot - ptk
    z_cell_bot = z_cell_top - P['cell_h']
    box(c, (xe - P['cell_l'] / 2, yc - P['cell_w'] / 2, z_cell_bot),
        (xe + P['cell_l'] / 2, yc + P['cell_w'] / 2, z_cell_top), 'Тензодатчик 3 кг (покупной)')
    gap = z_cell_bot - L['z_plate_top']
    if gap < 1:
        raise RuntimeError('Весы не помещаются под накопителем: не хватает %.1f мм. Уменьшите funnel_h или flap_box_z.' % (1 - gap))
    box(c, (xe - P['cell_l'] / 2, yc - P['cell_w'] / 2, L['z_plate_top']),
        (xe + P['cell_l'] / 2, yc + P['cell_w'] / 2, z_cell_bot), 'Проставка весов — сталь %g' % gap)
    return c


def build_hopper(ctx, parent, P, L):
    c = new_component(parent, 'Бункер-дозагрузчик и вибролоток')
    py, za = P['post_y'], L['z_arm_top']
    square_tube(c, 'z', (0, py), P['tube'], P['tube_t'], L['z_plate_top'], za - P['arm_t'],
                'Стойка бункера — профтруба 40×40×2')
    box(c, (-P['arm_x'] / 2, py - P['arm_y'] / 2, za - P['arm_t']), (P['arm_x'] / 2, py + P['arm_y'] / 2, za),
        'Плита стойки — сталь %g' % P['arm_t'], flat=True)
    box(c, (-P['feeder_x'] / 2, py - P['feeder_y'] / 2, za), (P['feeder_x'] / 2, py + P['feeder_y'] / 2,
        L['z_tray_floor'] - P['tray_t']), 'Линейный вибропитатель (покупной)')
    u_channel(c, 'y', 0, L['z_tray_floor'], P['tray_w'], P['tray_wall'], P['tray_t'], P['tray_y1'], P['tray_y2'],
              'Вибролоток — AISI 304 %g' % P['tray_t'])
    hy, zh = P['hopper_cy'], L['z_hopper_bot']
    frustum_shell(c, zh, (0, hy, P['hopper_bot_x'], P['hopper_y']), zh + P['hopper_h'],
                  (0, hy, P['hopper_top_x'], P['hopper_y']), P['hopper_t'], 'Бункер 10 л — AISI 304 %g' % P['hopper_t'])
    for s, nm in ((-1, 'А'), (1, 'Б')):
        x0 = s * (P['hopper_top_x'] / 2 + P['bar_t'] / 2)
        box(c, (x0 - P['bar_t'] / 2, py - P['bar_w'] / 2, za), (x0 + P['bar_t'] / 2, py + P['bar_w'] / 2, zh + P['hopper_h']),
            'Кронштейн бункера %s — полоса %g×%g' % (nm, P['bar_w'], P['bar_t']), flat=True)
    return c


def build_level_sensor(ctx, parent, P, L):
    c = new_component(parent, 'Датчик уровня')
    x, y = P['level_xy']
    z1 = L['z_rim'] + 40
    cylinder(c, 'z', (x, y), P['level_d'] / 2, z1, z1 + P['level_len'], 'Датчик уровня M18 (покупной)')
    return c


# ============================ ЗАПУСК ============================
def run(context):
    ui = None
    try:
        ctx = Ctx()
        ui = ctx.ui
        L = layout(P)
        FLAT_SKETCHES.clear()

        top = new_component(ctx.root, 'Счётная станция — чаша Ø%g' % P['bowl_d'])
        errors = []

        def step(name, fn, *args):
            try:
                return fn(ctx, top, P, L, *args)
            except Exception:
                errors.append('%s: %s' % (name, traceback.format_exc().strip().splitlines()[-1]))
                return None

        step('Рама стенда', build_frame)
        step('Вибропривод', build_drive)
        bowl = step('Виброчаша', build_bowl)
        if bowl:
            step('Счёт и стоп-штифт', build_counter, bowl['chute'])
        step('Накопитель', build_accumulator)
        step('Стендовые весы', build_scale)
        step('Бункер и вибролоток', build_hopper)
        step('Датчик уровня', build_level_sensor)

        gap = (L['z_top_plate_bot'] - P['armature_t']) - (L['z_mass_top'] + P['magnet_h'])
        notes = [
            'Высота кромки чаши: %.0f мм от пола' % L['z_rim'],
            'Высота выхода дорожки: %.0f мм' % L['z_track_exit'],
            'Воздушный зазор электромагнита: %.1f мм (цель %g; регулируется прокладками под якорь)' % (gap, P['air_gap']),
            'Верх бункера: %.0f мм от пола' % (L['z_hopper_bot'] + P['hopper_h']),
        ]
        if EXPORT_DXF:
            files = export_dxf(ctx, os.path.join(HERE, 'out', 'dxf'))
            notes.append('DXF плоских деталей: %d файлов в out/dxf' % len(files))

        ctx.app.activeViewport.fit()
        msg = 'Счётная станция построена.\n\n' + '\n'.join(notes)
        if errors:
            msg += '\n\nНе построены (остальное на месте):\n' + '\n'.join(errors)
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox('Ошибка скрипта:\n' + traceback.format_exc())
