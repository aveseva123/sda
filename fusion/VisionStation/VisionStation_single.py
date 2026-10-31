# -*- coding: utf-8 -*-
"""Однофайловая сборка. Визуальная счётная станция (камера + ИИ, лента) — скрипт Fusion 360.

Строит параметрическую сборку прототипа: рама стенда, ленточный конвейер 150×700 с приводом NEMA23,
загрузочный лоток и планка-ограничитель слоя, капот с камерой Raspberry Pi и LED-подсветкой,
воронка с заслонкой на сервоприводе, стендовые весы, дисплей и электроника.
Детали с пометкой [3D] печатаются на 3D-принтере.

Запуск: Fusion 360 → Utilities → Scripts and Add-Ins → Scripts → «+» → эта папка → Run.
Размеры — в словаре P ниже. Повторный запуск строит новую сборку рядом со старой.
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
"""Параметры визуальной счётной станции (камера + ИИ, лента). Размеры в мм.

Схема: оператор высыпает детали в загрузочный лоток на старте ленты → планка-ограничитель
выравнивает слой → лента 150 мм → капот с камерой и подсветкой (счёт на проходе) →
сброс с конца ленты в воронку → заслонка на сервоприводе → пакет / ковш на весах.

Ось ленты — X (движение в +X), Z вверх, пол на Z = 0. Начало координат — передний (входной) ролик ленты.
Детали с пометкой [3D] печатаются на 3D-принтере (PETG), остальное — лист, профиль, покупное.
"""

P = dict(
    # --- деталь
    part_l_max=80, part_h_max=10,

    # --- стенд
    frame_w=1300, frame_l=520, frame_cx=250, frame_cy=0,   # плита стенда и её центр
    frame_top_z=700, plate_t=5, tube=40, tube_t=2, brace_z=150, foot_d=60, foot_h=8,

    # --- лента
    belt_w=150, belt_t=2,                 # ширина и толщина ленты ПВХ
    belt_len=700,                         # межосевое расстояние роликов
    roller_d=40, roller_len=170,          # ролик: труба Ø40 + печатные торцы [3D]
    axle_d=8,                             # ось ролика
    side_t=5, side_h=90,                  # боковина конвейера, алюминий 5 мм
    conv_base_z=220,                      # низ боковины над плитой стенда
    guide_h=15, guide_t=8,                # направляющие ленты сверху [3D]
    support_t=2,                          # опорная пластина под верхней ветвью, сталь 2 мм
    motor=56, motor_len=76,               # NEMA23
    pulley_small_d=16, pulley_big_d=42, pulley_w=12,   # GT2 20T и 60T [3D]
    conv_speed=150,                       # мм/с, для записи

    # --- капот камеры
    hood_x=260, hood_y=240, hood_h=340,   # внутренний объём капота над лентой
    hood_t=3,                             # стенки: ПВХ/АКП 3 мм, углы и крепления [3D]
    hood_x0=250,                          # начало капота по X от входного ролика
    hood_slot_h=45,                       # окно для ленты в торцах
    cam_w=38, cam_h=30, lens_d=30, lens_len=40,      # Raspberry Pi GS camera + объектив 6 мм
    cam_height=300,                       # камера над лентой (поле ≈ 250×190 мм при 6 мм)
    led_len=200, led_w=12, led_h=10,      # LED-планки с рассеивателем, 2 шт [3D] держатели

    # --- выход
    funnel_top_x=200, funnel_top_y=180, funnel_out=55, funnel_h=120, funnel_t=2,   # [3D] две половины
    gate_len=70, gate_t=3,                # заслонка выхода [3D] на сервоприводе
    servo=(40, 20, 38),                   # MG996R / DS3218
    cup_d=80, cup_h=60, platform=150, platform_t=3, cell_l=130, cell_w=30, cell_h=22,

    # --- загрузка вручную
    tub_len=220, tub_wall_h=80, tub_t=3,  # загрузочный лоток с бортами на старте ленты [3D]
    gate_h_gap=12,                        # просвет планки-ограничителя над лентой (≈ 1,2 высоты детали)
    gate_x=200, gate_plate_t=4,                 # планка-ограничитель перед капотом [3D], по высоте регулируется

    # --- электроника и интерфейс
    display=(190, 120, 22), display_z=1100, display_x=600,     # 7″ сенсорный дисплей на кронштейне [3D]
    pi_box=(110, 80, 40),                 # корпус Raspberry Pi 5 [3D]
    psu_box=(160, 50, 40),                # блок питания 24 В под плитой
)


def layout(p=P):
    L = {}
    L['z_plate_top'] = p['frame_top_z']
    L['z_side_bot'] = L['z_plate_top'] + p['conv_base_z']
    L['z_side_top'] = L['z_side_bot'] + p['side_h']
    L['z_axle'] = L['z_side_bot'] + p['side_h'] / 2.0
    L['z_belt_top'] = L['z_axle'] + p['roller_d'] / 2.0 + p['belt_t']
    L['z_belt_bot'] = L['z_axle'] - p['roller_d'] / 2.0 - p['belt_t']
    L['x_in'] = 0.0
    L['x_out'] = p['belt_len']
    L['x_hood0'] = p['hood_x0']
    L['x_hood1'] = p['hood_x0'] + p['hood_x']
    L['z_cam'] = L['z_belt_top'] + p['cam_height']
    L['z_hood_top'] = L['z_belt_top'] + p['hood_h']
    L['x_funnel'] = L['x_out'] + p['roller_d'] / 2.0 + p['funnel_top_x'] / 2.0 - 40
    L['z_funnel_top'] = L['z_belt_bot'] - 10
    L['z_funnel_bot'] = L['z_funnel_top'] - p['funnel_h']
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
"""Построители узлов визуальной счётной станции. Каждый узел — свой компонент, геометрия в мировых мм.

Ось ленты — X (движение в +X), Z вверх, пол на Z = 0, начало координат — ось входного ролика.
Тела с пометкой [3D] печатаются на 3D-принтере.
"""


def yr(s, a, b):
    """Диапазон по Y для стороны s=±1: от a до b (0 <= a < b), с нужным знаком."""
    return (a, b) if s > 0 else (-b, -a)


def build_frame(ctx, parent, P, L):
    c = new_component(parent, 'Рама стенда')
    cx, cy = P['frame_cx'], P['frame_cy']
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


def build_conveyor(ctx, parent, P, L):
    c = new_component(parent, 'Ленточный конвейер %g×%g' % (P['belt_w'], P['belt_len']))
    bw, bl, rd, rl = P['belt_w'], P['belt_len'], P['roller_d'], P['roller_len']
    y_side_in = bw / 2 + 10                       # внутренняя плоскость боковины
    y_side_out = y_side_in + P['side_t']
    x0, x1 = -rd / 2 - 20, bl + rd / 2 + 20
    za = L['z_axle']
    for s, nm in ((-1, 'А'), (1, 'Б')):
        y1, y2 = yr(s, y_side_in, y_side_out)
        box(c, (x0, y1, L['z_side_bot']), (x1, y2, L['z_side_top']), 'Боковина %s — алюминий %g' % (nm, P['side_t']), flat=True)
    for x, nm in ((0, 'ведомый'), (bl, 'ведущий')):
        cylinder(c, 'y', (x, za), rd / 2, -rl / 2, rl / 2, 'Ролик %s — труба Ø%g' % (nm, rd))
        for s in (-1, 1):
            cylinder(c, 'y', (x, za), rd / 2 - 2, s * rl / 2, s * (rl / 2 + 8), '[3D] Торец ролика %s' % nm)
            cylinder(c, 'y', (x, za), 11, s * y_side_in, s * y_side_out, 'Подшипник 608ZZ', r_in=P['axle_d'] / 2)
        cylinder(c, 'y', (x, za), P['axle_d'] / 2, -(y_side_out + 12), y_side_out + 12, 'Ось ролика Ø%g — сталь' % P['axle_d'])
    for s in (-1, 1):
        y1, y2 = yr(s, y_side_out, y_side_out + 15)
        box(c, (-45, y1, za - 25), (5, y2, za + 25), '[3D] Натяжитель ведомого ролика')
    zt = za + rd / 2
    box(c, (-rd / 2, -bw / 2, zt), (bl + rd / 2, bw / 2, zt + P['belt_t']),
        'Лента ПВХ %g×%g — верхняя ветвь (бесконечная L≈%.0f)' % (bw, P['belt_t'], 2 * bl + math.pi * rd))
    box(c, (-rd / 2, -bw / 2, za - rd / 2 - P['belt_t']), (bl + rd / 2, bw / 2, za - rd / 2), 'Лента ПВХ — нижняя ветвь')
    box(c, (rd / 2 + 5, -bw / 2, zt - P['support_t']), (bl - rd / 2 - 5, bw / 2, zt), 'Опорная пластина ленты — сталь %g' % P['support_t'], flat=True)
    for s in (-1, 1):
        y1, y2 = yr(s, bw / 2 - P['guide_t'], bw / 2)
        box(c, (P['tub_len'], y1, L['z_belt_top']), (bl - 30, y2, L['z_belt_top'] + P['guide_h']), '[3D] Направляющая ленты')
    # привод: NEMA23 под лентой, ремень GT2 на ведущий ролик
    xm, zm = bl - 120, za - 110
    m = P['motor']
    box(c, (xm - P['motor_len'] / 2, -m / 2, zm - m / 2), (xm + P['motor_len'] / 2, m / 2, zm + m / 2), 'Шаговый двигатель NEMA23 (покупной)')
    cylinder(c, 'y', (xm, zm), 3.2, m / 2, y_side_out + 12, 'Вал двигателя')
    cylinder(c, 'y', (xm, zm), P['pulley_small_d'] / 2, y_side_out + 2, y_side_out + 2 + P['pulley_w'], 'Шкив GT2 20T (покупной)')
    cylinder(c, 'y', (bl, za), P['pulley_big_d'] / 2, y_side_out + 2, y_side_out + 2 + P['pulley_w'], '[3D] Шкив GT2 60T')
    box(c, (xm - 40, -m / 2 - 3, zm - m / 2 - 3), (xm + 40, m / 2 + 3, zm - m / 2), 'Кронштейн двигателя — сталь 3', flat=True)
    square_tube(c, 'z', (xm, 0), P['tube'], P['tube_t'], L['z_plate_top'], zm - m / 2 - 3, 'Стойка двигателя — профтруба 40×40')
    for x in (40, bl - 40):
        for s in (-1, 1):
            square_tube(c, 'z', (x, s * (y_side_out + 20)), P['tube'], P['tube_t'], L['z_plate_top'], L['z_side_bot'] + 30,
                        'Стойка конвейера — профтруба 40×40')
    return c


def build_loading(ctx, parent, P, L):
    c = new_component(parent, 'Загрузка вручную')
    bw, t = P['belt_w'], P['tub_t']
    zt = L['z_belt_top']
    h = P['tub_wall_h']
    for s, nm in ((-1, 'А'), (1, 'Б')):
        y1, y2 = yr(s, bw / 2 - t, bw / 2)
        box(c, (-10, y1, zt), (P['tub_len'], y2, zt + h), '[3D] Загрузочный лоток — борт %s' % nm)
    box(c, (-10, -bw / 2, zt), (-10 + t, bw / 2, zt + h), '[3D] Загрузочный лоток — задняя стенка')
    g = P['gate_plate_t']
    box(c, (P['gate_x'], -bw / 2 - 10, zt + P['gate_h_gap']), (P['gate_x'] + g, bw / 2 + 10, zt + P['gate_h_gap'] + 60),
        '[3D] Планка-ограничитель слоя (просвет %g, регулируется по высоте)' % P['gate_h_gap'])
    for s in (-1, 1):
        y1, y2 = yr(s, bw / 2 + 10, bw / 2 + 22)
        box(c, (P['gate_x'] - 8, y1, zt - 5), (P['gate_x'] + g + 8, y2, zt + 80), '[3D] Стойка планки с пазом регулировки')
    return c


def build_hood(ctx, parent, P, L):
    c = new_component(parent, 'Капот камеры и подсветка')
    x0, x1 = L['x_hood0'], L['x_hood1']
    hy, t = P['hood_y'], P['hood_t']
    zb = L['z_belt_top'] - 60
    zt = L['z_hood_top']
    for s, nm in ((-1, 'А'), (1, 'Б')):
        y1, y2 = yr(s, hy / 2 - t, hy / 2)
        box(c, (x0, y1, zb), (x1, y2, zt), 'Стенка капота %s — ПВХ/АКП %g' % (nm, t), flat=True)
    z_slot = L['z_belt_top'] + P['hood_slot_h']
    for x, nm in ((x0, 'вход'), (x1 - t, 'выход')):
        box(c, (x, -hy / 2, z_slot), (x + t, hy / 2, zt), 'Торец капота %s — верх над окном ленты' % nm, flat=True)
        for s in (-1, 1):
            y1, y2 = yr(s, P['belt_w'] / 2 + 20, hy / 2)
            box(c, (x, y1, zb), (x + t, y2, z_slot), 'Торец капота %s — боковая вставка' % nm)
    box(c, (x0, -hy / 2, zt - t), (x1, hy / 2, zt), 'Крыша капота — ПВХ/АКП %g' % t, flat=True)
    for x in (x0, x1 - 15):
        for s in (-1, 1):
            y1, y2 = yr(s, hy / 2 - t - 15, hy / 2 - t)
            box(c, (x, y1, zb), (x + 15, y2, zt - t), '[3D] Угловой соединитель капота')
    xc = (x0 + x1) / 2
    zc = L['z_cam']
    box(c, (xc - P['cam_w'] / 2, -P['cam_w'] / 2, zc), (xc + P['cam_w'] / 2, P['cam_w'] / 2, zc + P['cam_h']),
        'Камера Raspberry Pi Global Shutter (покупная)')
    cylinder(c, 'z', (xc, 0), P['lens_d'] / 2, zc - P['lens_len'], zc, 'Объектив 6 мм CS (покупной)')
    box(c, (xc - 35, -35, zc + P['cam_h']), (xc + 35, 35, zt - t), '[3D] Кронштейн камеры к крыше')
    zl = L['z_belt_top'] + 150
    for s, nm in ((-1, 'А'), (1, 'Б')):
        yl = s * (hy / 2 - 30)
        box(c, (x0 + 30, yl - P['led_w'] / 2, zl), (x0 + 30 + P['led_len'], yl + P['led_w'] / 2, zl + P['led_h']),
            'LED-планка %s 24 В с рассеивателем' % nm)
        for x in (x0 + 35, x0 + 25 + P['led_len']):
            y1, y2 = yr(s, abs(yl) - 8, hy / 2 - t)
            box(c, (x, y1, zl - 12), (x + 12, y2, zl + P['led_h'] + 2), '[3D] Держатель LED-планки')
    return c


def build_outlet(ctx, parent, P, L):
    c = new_component(parent, 'Выход, заслонка и весы')
    xf = L['x_funnel']
    zt, zb = L['z_funnel_top'], L['z_funnel_bot']
    frustum_shell(c, zb, (xf, 0, P['funnel_out'], P['funnel_out']), zt, (xf, 0, P['funnel_top_x'], P['funnel_top_y']),
                  P['funnel_t'], '[3D] Воронка (две половины)')
    for s in (-1, 1):
        for x in (xf - P['funnel_top_x'] / 2 + 10, xf + P['funnel_top_x'] / 2 - 10):
            square_tube(c, 'z', (x, s * (P['funnel_top_y'] / 2 + 12)), 20, 2, L['z_plate_top'], zt, 'Стойка воронки — алюминиевый профиль 20×20')
    g = P['gate_t']
    box(c, (xf - 38, -35, zb - 2 - g), (xf + 38, 35, zb - 2), '[3D] Заслонка выхода (показана закрытой)')
    cylinder(c, 'y', (xf - 38, zb - 2 - g / 2), 2, -45, 45, 'Ось заслонки Ø4')
    sw, sd, sh = P['servo']
    box(c, (xf - 38 - sw / 2, 45, zb - 2 - sh / 2), (xf - 38 + sw / 2, 45 + sd, zb - 2 + sh / 2), 'Сервопривод MG996R/DS3218 (покупной)')
    box(c, (xf - 38 - sw / 2 - 3, 35, zb - 2 - sh / 2 - 3), (xf - 38 + sw / 2 + 3, 45 + sd + 3, zb - 2 - sh / 2), '[3D] Кронштейн сервопривода')
    z_cup_top = zb - 2 - g - 10
    z_cup_bot = z_cup_top - P['cup_h']
    f = cylinder(c, 'z', (xf, 0), P['cup_d'] / 2, z_cup_bot, z_cup_top, '[3D] Ковш / держатель пакета')
    body = f.bodies.item(0)
    shell(c, body, [planar_faces_by_z(body)[-1]], 2)
    pl, pt_ = P['platform'], P['platform_t']
    box(c, (xf - pl / 2, -pl / 2, z_cup_bot - pt_), (xf + pl / 2, pl / 2, z_cup_bot), 'Платформа весов — алюминий %g' % pt_, flat=True)
    z_cell_top = z_cup_bot - pt_
    z_cell_bot = z_cell_top - P['cell_h']
    box(c, (xf - P['cell_l'] / 2, -P['cell_w'] / 2, z_cell_bot), (xf + P['cell_l'] / 2, P['cell_w'] / 2, z_cell_top), 'Тензодатчик 3 кг (покупной)')
    gap = z_cell_bot - L['z_plate_top']
    if gap < 1:
        raise RuntimeError('Весы не помещаются под воронкой: не хватает %.1f мм. Увеличьте conv_base_z или уменьшите funnel_h.' % (1 - gap))
    box(c, (xf - P['cell_l'] / 2, -P['cell_w'] / 2, L['z_plate_top']), (xf + P['cell_l'] / 2, P['cell_w'] / 2, z_cell_bot), '[3D] Проставка весов %g' % gap)
    return c


def build_electronics(ctx, parent, P, L):
    c = new_component(parent, 'Электроника и интерфейс')
    dw, dh, dt = P['display']
    xd, zd = P['display_x'], P['display_z']
    yf = P['frame_cy'] - P['frame_l'] / 2
    box(c, (xd - dw / 2, yf - 30 - dt, zd), (xd + dw / 2, yf - 30, zd + dh), 'Сенсорный дисплей 7″ (покупной)')
    square_tube(c, 'z', (xd, yf + 20), 20, 2, L['z_plate_top'], zd + dh / 2, 'Стойка дисплея — алюминиевый профиль 20×20')
    box(c, (xd - 10, yf - 30, zd + dh / 2 - 10), (xd + 10, yf + 30, zd + dh / 2 + 10), '[3D] Кронштейн дисплея с наклоном')
    bx, by, bz = P['pi_box']
    box(c, (xd - bx / 2, -100 - by / 2, L['z_plate_top'] - P['plate_t'] - bz), (xd + bx / 2, -100 + by / 2, L['z_plate_top'] - P['plate_t']),
        '[3D] Корпус Raspberry Pi 5 с вентиляцией')
    px, py, pz = P['psu_box']
    box(c, (xd - 150 - px / 2, -100 - py / 2, L['z_plate_top'] - P['plate_t'] - pz), (xd - 150 + px / 2, -100 + py / 2, L['z_plate_top'] - P['plate_t']),
        'Блок питания 24 В 5 А (покупной)')
    cylinder(c, 'y', (xd + 150, L['z_plate_top'] + 60), 20, yf - 30, yf - 10, 'Кнопка аварийного стопа (покупная)')
    box(c, (xd + 150 - 35, yf, L['z_plate_top']), (xd + 150 + 35, yf + 3, L['z_plate_top'] + 90), 'Панель кнопок — сталь 3', flat=True)
    return c


# ============================ ЗАПУСК ============================
def run(context):
    ui = None
    try:
        ctx = Ctx()
        ui = ctx.ui
        L = layout(P)
        FLAT_SKETCHES.clear()

        top = new_component(ctx.root, 'Визуальная счётная станция — лента %g×%g' % (P['belt_w'], P['belt_len']))
        errors = []

        def step(name, fn, *args):
            try:
                return fn(ctx, top, P, L, *args)
            except Exception:
                errors.append('%s: %s' % (name, traceback.format_exc().strip().splitlines()[-1]))
                return None

        step('Рама стенда', build_frame)
        step('Конвейер', build_conveyor)
        step('Загрузка', build_loading)
        step('Капот камеры', build_hood)
        step('Выход и весы', build_outlet)
        step('Электроника', build_electronics)

        fov_x = 250.0 * P['cam_height'] / 300.0
        notes = [
            'Верх ленты: %.0f мм от пола' % L['z_belt_top'],
            'Камера на %g мм над лентой, поле кадра ≈ %.0f×%.0f мм (объектив 6 мм)' % (P['cam_height'], fov_x, fov_x * 0.75),
            'Скорость ленты %g мм/с → деталь в кадре ≈ %.1f с' % (P['conv_speed'], fov_x / P['conv_speed']),
            'Верх капота: %.0f мм от пола' % L['z_hood_top'],
        ]
        if EXPORT_DXF:
            files = export_dxf(ctx, os.path.join(HERE, 'out', 'dxf'))
            notes.append('DXF плоских деталей: %d файлов в out/dxf' % len(files))

        ctx.app.activeViewport.fit()
        msg = 'Визуальная счётная станция построена.\n\n' + '\n'.join(notes)
        if errors:
            msg += '\n\nНе построены (остальное на месте):\n' + '\n'.join(errors)
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox('Ошибка скрипта:\n' + traceback.format_exc())
