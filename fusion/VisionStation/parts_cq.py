# -*- coding: utf-8 -*-
"""Реалистичные формы покупных деталей, отверстия, крепёж и электрика до жилы. Только CadQuery.

enrich(P, L) вызывается после station.py и detail.py: заменяет упрощённые тела в cq_helpers.PARTS
подробными и добавляет то, чего в упрощённой модели нет. Координаты — мм, Z вверх.
"""
import math
import cadquery as cq
import cq_helpers as H

NEW = H.NEW
V = cq.Vector


def add(comp, name, shape):
    H.PARTS.append({'comp': comp, 'name': name, 'shape': shape})


def drop(pattern):
    """Убрать упрощённые тела по подстроке имени (без учёта регистра)."""
    p = pattern.lower()
    H.PARTS[:] = [x for x in H.PARTS if p not in x['name'].lower()]


def wp(axis, a, u=0.0, v=0.0):
    """Workplane, перпендикулярная axis, на координате a; локальные оси: x→u, y→v (без переворотов)."""
    if axis == 'z':
        return cq.Workplane(cq.Plane(origin=(u, v, a), xDir=(1, 0, 0), normal=(0, 0, 1)))
    if axis == 'y':
        return cq.Workplane(cq.Plane(origin=(u, a, v), xDir=(1, 0, 0), normal=(0, -1, 0)))   # local y = +Z
    return cq.Workplane(cq.Plane(origin=(a, u, v), xDir=(0, 1, 0), normal=(1, 0, 0)))         # local y = +Z


def box(x1, y1, z1, x2, y2, z2):
    lo = (min(x1, x2), min(y1, y2), min(z1, z2))
    return cq.Solid.makeBox(abs(x2 - x1), abs(y2 - y1), abs(z2 - z1), V(*lo))


def cyl(axis, uv, r, a1, a2):
    lo, hi = min(a1, a2), max(a1, a2)
    d = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    pnt = {'x': (lo, uv[0], uv[1]), 'y': (uv[0], lo, uv[1]), 'z': (uv[0], uv[1], lo)}[axis]
    return cq.Solid.makeCylinder(r, hi - lo, V(*pnt), V(*d))


def holes(shape, axis, pts, r, a1, a2):
    tools = [cyl(axis, p, r, a1, a2) for p in pts]
    return shape.cut(cq.Compound.makeCompound(tools))


def slot_cuts(shape, axis, slots):
    """slots: список (u1, v1, u2, v2, a1, a2) прямоугольных вырезов в плоскости ⟂ axis."""
    tools = []
    for u1, v1, u2, v2, a1, a2 in slots:
        if axis == 'z':
            tools.append(box(u1, v1, a1, u2, v2, a2))
        elif axis == 'y':
            tools.append(box(u1, a1, v1, u2, a2, v2))
        else:
            tools.append(box(a1, u1, v1, a2, u2, v2))
    return shape.cut(cq.Compound.makeCompound(tools))


def hex_nut(axis, uv, d, a1, a2):
    r = 0.95 * d
    s = cq.Workplane('XY').polygon(6, 2 * r).extrude(abs(a2 - a1)).val()
    s = s.cut(cq.Solid.makeCylinder(d / 2, abs(a2 - a1) + 2, V(0, 0, -1), V(0, 0, 1)))
    return orient(s, axis, uv, min(a1, a2))


def washer(axis, uv, d, a1, a2):
    s = cyl('z', (0, 0), d, 0, abs(a2 - a1)).cut(cyl('z', (0, 0), d / 2 + 0.3, -1, abs(a2 - a1) + 1))
    return orient(s, axis, uv, min(a1, a2))


def orient(solid_z, axis, uv, a):
    """Тело, построенное вдоль +Z от 0, повернуть на ось axis и поставить в (uv, a)."""
    if axis == 'z':
        return solid_z.translate(V(uv[0], uv[1], a))
    if axis == 'x':
        return solid_z.rotate(V(0, 0, 0), V(0, 1, 0), 90).translate(V(a, uv[0], uv[1]))
    return solid_z.rotate(V(0, 0, 0), V(1, 0, 0), -90).translate(V(uv[0], a, uv[1]))


# ============================ покупные детали ============================
def nema23(c, xm, zm, P):
    """NEMA23 57×57×76, ось по +Y, вал в +Y. Корпус с фасками, крышки, фланец Ø38.1, вал 6.35 с лыской, 4 отв. M5."""
    m, Lm = 56.4, P['motor_len']
    body = (cq.Workplane('XY').rect(m, m).extrude(Lm).edges('|Z').chamfer(5).val())
    body = holes(body, 'z', [(sx * 23.57, sy * 23.57) for sx in (-1, 1) for sy in (-1, 1)], 2.5, Lm - 6, Lm + 1)
    body = body.translate(V(0, 0, -Lm / 2))
    caps = [box(-m / 2 - 0.5, -m / 2 - 0.5, z, m / 2 + 0.5, m / 2 + 0.5, z + 9) for z in (-Lm / 2, Lm / 2 - 9)]
    for cap in caps:
        cap = cq.Workplane('XY').add(cap).edges('|Z').chamfer(5).val()
        body = body.fuse(cap)
    boss = cyl('z', (0, 0), 19.05, Lm / 2, Lm / 2 + 1.6)
    shaft = cyl('z', (0, 0), 3.175, Lm / 2, Lm / 2 + 21).cut(box(2.4, -5, Lm / 2 + 6, 6, 5, Lm / 2 + 22))
    rear = cyl('z', (0, 0), 16, -Lm / 2 - 3, -Lm / 2)
    wirebox = box(-8, -m / 2 - 2, -Lm / 2 - 10, 8, -m / 2 + 8, -Lm / 2)
    for s, n in ((body.fuse(boss), 'Шаговый двигатель NEMA23 2,8 А (покупной) — корпус 57×57×76, фланец Ø38,1, 4 отв. M5'),
                 (shaft, 'NEMA23 — вал Ø6,35 с лыской'), (rear, 'NEMA23 — задняя крышка'), (wirebox, 'NEMA23 — вывод 4 проводов')):
        add(c, n, orient(s, 'y', (xm, zm), 0).translate(V(0, 0, 0)))
    # 4 жилы к кабелю двигателя
    for i, col in enumerate(('красный', 'синий', 'зелёный', 'чёрный')):
        y0 = -m / 2 - 8
        add(c, 'Жила двигателя %s: обмотка → кабель' % col,
            H_cable([(xm - 6 + 4 * i, y0, zm - 6), (xm - 6 + 4 * i, y0 - 6, zm - 8), (xm, -m / 2 - 7, zm - 8)], 0.8))


def H_cable(pts, r):
    verts = [V(*p) for p in pts]
    try:
        wire = cq.Wire.makePolygon(verts)
        plane = cq.Plane(origin=verts[0], normal=(verts[1] - verts[0]).normalized())
        return cq.Workplane(plane).circle(r).sweep(cq.Workplane('XY').add(wire), transition='round').val()
    except Exception:
        parts = [cq.Solid.makeCylinder(r, (b - a).Length, a, (b - a).normalized()) for a, b in zip(verts[:-1], verts[1:])]
        return cq.Compound.makeCompound(parts)


def bearing_608(c, x, z, y1, y2):
    outer = cyl('y', (x, z), 11, y1, y2).cut(cyl('y', (x, z), 9.5, y1 - 1, y2 + 1))
    inner = cyl('y', (x, z), 6, y1, y2).cut(cyl('y', (x, z), 4, y1 - 1, y2 + 1))
    shield = cyl('y', (x, z), 9.4, y1 + 0.5, y2 - 0.5).cut(cyl('y', (x, z), 6.1, y1 - 1, y2 + 1))
    add(c, 'Подшипник 608ZZ — наружное кольцо Ø22', outer)
    add(c, 'Подшипник 608ZZ — внутреннее кольцо Ø8', inner)
    add(c, 'Подшипник 608ZZ — защитные шайбы ZZ', shield)


def servo_ds3218(c, xh, zh, sw, sd, sh):
    """Серва: корпус с ушами (4 отв. Ø4,5), выходной шлиц, качалка с 6 отверстиями."""
    x0, y0, z0 = xh - 10, 45, zh - sh / 2
    body = cq.Workplane('XY').add(box(x0, y0, z0, x0 + sw, y0 + sd, z0 + sh)).edges('|Y').fillet(1.5).val()
    ears = box(x0 - 7.25, y0 + 8.5, z0 + sh - 10, x0 + sw + 7.25, y0 + 11, z0 + sh - 7.5)
    ears = holes(ears, 'y', [(x0 - 3.6, z0 + sh - 8.75), (x0 + sw + 3.6, z0 + sh - 8.75)], 2.25, y0 + 7, y0 + 12)
    add(c, 'Сервопривод DS3218 PRO (покупной) — корпус 40×20×38,5', body)
    add(c, 'DS3218 — фланец с ушами, 4 отв. Ø4,5', ears)
    add(c, 'DS3218 — выходной шлиц 25T', cyl('y', (xh, zh), 3, 38, 45))
    add(c, 'DS3218 — ступица', cyl('y', (xh, zh), 6, 42, 45))
    horn = cyl('y', (xh, zh), 10, 36, 38)
    horn = holes(horn, 'y', [(xh + 7 * math.cos(a), zh + 7 * math.sin(a)) for a in [i * math.pi / 3 for i in range(6)]], 0.9, 35, 39)
    add(c, 'DS3218 — качалка Ø20 с 6 отв. (покупная)', horn)
    add(c, 'DS3218 — вывод кабеля', box(x0 + sw - 8, y0 + 6, z0 - 3, x0 + sw - 2, y0 + 14, z0))


def rpi5(c, px0, py, pz0, by0, t):
    """Raspberry Pi 5: плата с отверстиями, реальные разъёмы с окнами, GPIO 2×20 штырьков, кулер с рёбрами."""
    pcb = cq.Workplane('XY').rect(85, 56).extrude(1.6).edges('|Z').fillet(3).val()
    pcb = holes(pcb, 'z', [(-39, -24.5), (19, -24.5), (-39, 24.5), (19, 24.5)], 1.35, -1, 3)
    pcb = orient(pcb, 'y', (px0 + 42.5, pz0 + 28), py)
    add(c, 'Raspberry Pi 5 8 ГБ (покупной) — плата 85×56, 4 отв. Ø2,7', pcb)
    yf = py + 1.6

    def conn(name, x1, z1, x2, z2, depth, opening=None):
        s = box(x1, yf, z1, x2, yf + depth, z2)
        if opening:
            ox1, oz1, ox2, oz2 = opening
            s = s.cut(box(ox1, yf + depth - 12, oz1, ox2, yf + depth + 1, oz2))
        add(c, name, s)
    conn('Порт Ethernet RJ45', px0 + 70, pz0 + 3, px0 + 86, pz0 + 19, 21, (px0 + 72, pz0 + 5, px0 + 84, pz0 + 17))
    conn('Порты USB 3.0 ×2 (синие)', px0 + 71, pz0 + 22, px0 + 85.5, pz0 + 38, 17.3, (px0 + 73, pz0 + 24, px0 + 83.5, pz0 + 29))
    conn('Порты USB 2.0 ×2', px0 + 71, pz0 + 40, px0 + 85.5, pz0 + 56, 17.3, (px0 + 73, pz0 + 42, px0 + 83.5, pz0 + 47))
    conn('Порт USB-C питания 5 В 5 А', px0 + 4, pz0 - 1.5, px0 + 13, pz0 + 1.8, 7.3, (px0 + 5.2, pz0 - 0.5, px0 + 11.8, pz0 + 0.8))
    conn('Порт micro-HDMI 0', px0 + 18, pz0 - 1.5, px0 + 25, pz0 + 1.5, 6.5)
    conn('Порт micro-HDMI 1', px0 + 32, pz0 - 1.5, px0 + 39, pz0 + 1.5, 6.5)
    conn('Разъём CAM/DISP 0 (22 pin)', px0 + 44, pz0 - 0.5, px0 + 55, pz0 + 2, 4)
    conn('Разъём CAM/DISP 1 (22 pin)', px0 + 56, pz0 - 0.5, px0 + 67, pz0 + 2, 4)
    conn('Гребёнка GPIO 2×20 — основание', px0 + 8, pz0 + 51, px0 + 59, pz0 + 56, 2.5)
    pins = [cyl('y', (px0 + 9.3 + i * 2.54, pz0 + 52.2 + j * 2.54), 0.32, yf + 2.5, yf + 8.5) for i in range(20) for j in range(2)]
    add(c, 'GPIO 2×20 — штырьки 0,64 мм, шаг 2,54', cq.Compound.makeCompound(pins))
    add(c, 'SoC BCM2712', box(px0 + 24, yf, pz0 + 14, px0 + 39, yf + 1.2, pz0 + 29))
    add(c, 'ОЗУ LPDDR4X 8 ГБ', box(px0 + 41, yf, pz0 + 14, px0 + 53, yf + 1.1, pz0 + 26))
    add(c, 'Разъём PCIe FPC', box(px0 + 1, yf, pz0 + 28, px0 + 6, yf + 2, pz0 + 44))
    add(c, 'Слот microSD', box(px0 + 10, py - 2, pz0 + 24, px0 + 26, py, pz0 + 36))
    add(c, 'Кнопка питания и разъём RTC', box(px0 + 1, yf, pz0 + 5, px0 + 5, yf + 2, pz0 + 9))
    # кулер: основание, рёбра, вентилятор
    hs = box(px0 + 18, yf + 1.5, pz0 + 10, px0 + 60, yf + 4, pz0 + 50)
    fins = [box(px0 + 19 + i * 3.5, yf + 4, pz0 + 10, px0 + 20.2 + i * 3.5, yf + 11, pz0 + 50) for i in range(12)]
    add(c, 'Активный кулер Pi 5 (покупной) — радиатор с 12 рёбрами', hs.fuse(cq.Compound.makeCompound(fins)))
    fan_ring = cyl('y', (px0 + 39, pz0 + 30), 15, yf + 11, yf + 13).cut(cyl('y', (px0 + 39, pz0 + 30), 13, yf + 10, yf + 14))
    add(c, 'Кулер — кольцо вентилятора Ø30', fan_ring)
    blades = []
    for k in range(7):
        a = k * 2 * math.pi / 7
        b = box(-1, -0.6, 4, 1, 0.6, 12.5).rotate(V(0, 0, 0), V(0, 1, 0), 35).rotate(V(0, 0, 0), V(0, 0, 1), math.degrees(a))
        blades.append(b)
    hub = cq.Solid.makeCylinder(4, 2, V(0, 0, 0), V(0, 0, 1))
    fan = hub.fuse(cq.Compound.makeCompound(blades)).rotate(V(0, 0, 0), V(1, 0, 0), -90).translate(V(px0 + 39, yf + 11, pz0 + 30))
    add(c, 'Кулер — крыльчатка 7 лопастей', fan)
    for sx, sz in ((3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)):
        add(c, 'Стойка M2.5×6 латунная', cyl('y', (px0 + sx, pz0 + sz), 2.5, by0 + t, py))
        add(c, 'Винт M2.5×5 платы Pi', cyl('y', (px0 + sx, pz0 + sz), 2.2, yf, yf + 1.8).fuse(cyl('y', (px0 + sx, pz0 + sz), 1.2, py - 0.5, yf)))


def display7(c, xd, yb, zd, dw, dh, dt):
    bezel = cq.Workplane('XY').add(box(xd - dw / 2, yb - dt, zd, xd + dw / 2, yb, zd + dh)).edges('|Y').fillet(4).val()
    bezel = bezel.cut(box(xd - dw / 2 + 9, yb - dt - 1, zd + 9, xd + dw / 2 - 9, yb - dt + 1.2, zd + dh - 9))
    add(c, 'Дисплей 7″ 1024×600 сенсорный (покупной) — рамка', bezel)
    add(c, 'Дисплей — стекло сенсора', box(xd - dw / 2 + 9, yb - dt + 0.4, zd + 9, xd + dw / 2 - 9, yb - dt + 1.2, zd + dh - 9))
    pcb = box(xd - 60, yb, zd + 30, xd + 60, yb + 1.6, zd + 90)
    pcb = holes(pcb, 'y', [(xd - 55, zd + 35), (xd + 55, zd + 35), (xd - 55, zd + 85), (xd + 55, zd + 85)], 1.5, yb - 1, yb + 3)
    add(c, 'Дисплей — плата контроллера HDMI, 4 отв. Ø3', pcb)
    add(c, 'Дисплей — разъём HDMI', box(xd - 35, yb + 1.6, zd + 40, xd - 20, yb + 7.6, zd + 50).cut(box(xd - 33, yb + 3, zd + 42, xd - 22, yb + 9, zd + 48)))
    add(c, 'Дисплей — разъём micro-USB сенсора', box(xd - 10, yb + 1.6, zd + 40, xd + 2, yb + 7.6, zd + 48))
    add(c, 'Дисплей — разъём питания 5 В', box(xd + 10, yb + 1.6, zd + 40, xd + 22, yb + 7.6, zd + 48))
    for sx in (-55, 55):
        for sz in (35, 85):
            add(c, 'Винт M3×6 платы дисплея', cyl('y', (xd + sx, zd + sz), 2.7, yb + 1.6, yb + 3.5))


def estop(c, x, y_face, z):
    """Аварийный стоп: грибок Ø40 с куполом, корпус, жёлтое кольцо, гайка, контактные блоки с винтами."""
    prof = (cq.Workplane('XZ').moveTo(0, 0).lineTo(20, 0).lineTo(20, 8).threePointArc((12, 13), (0, 15)).close())
    head = prof.revolve(360, (0, 0, 0), (0, 1, 0)).val()                       # ось Z локальная → повернём на -Y
    head = head.rotate(V(0, 0, 0), V(1, 0, 0), 90).translate(V(x, y_face - 10, z))
    add(c, 'Кнопка аварийного стопа грибок Ø40 (покупная)', head)
    add(c, 'Аварийный стоп — корпус с фиксацией', cyl('y', (x, z), 11, y_face - 10, y_face - 3))
    ring = cyl('y', (x, z), 30, y_face - 3, y_face - 1).cut(cyl('y', (x, z), 12, y_face - 4, y_face))
    add(c, 'Аварийный стоп — жёлтое кольцо Ø60 с надписью', ring)
    add(c, 'Аварийный стоп — гайка крепления', hex_nut('y', (x, z), 22, y_face, y_face + 6))
    for i, nm in enumerate(('Контактный блок NC1 аварийного стопа', 'Контактный блок NC2 аварийного стопа')):
        blk = box(x - 11 + i * 12, y_face + 6, z - 20, x - 1 + i * 12, y_face + 36, z + 20)
        blk = holes(blk, 'y', [(x - 6 + i * 12, z - 14), (x - 6 + i * 12, z + 14)], 1.6, y_face + 30, y_face + 38)
        add(c, nm, blk)


def pushbutton(c, x, y_face, z, name, lamp=False):
    head = cq.Workplane('XY').circle(11).extrude(5).edges('>Z').fillet(2).val().rotate(V(0, 0, 0), V(1, 0, 0), 90).translate(V(x, y_face - 3, z))
    add(c, name, head)
    add(c, name.split(' (')[0] + ' — кольцо-обод Ø28', cyl('y', (x, z), 14, y_face - 3, y_face - 1).cut(cyl('y', (x, z), 11.2, y_face - 4, y_face)))
    add(c, name.split(' (')[0] + ' — гайка', hex_nut('y', (x, z), 22, y_face, y_face + 5))
    blk = box(x - 6, y_face + 5, z - 12, x + 6, y_face + 28, z + 12)
    blk = holes(blk, 'y', [(x, z - 8), (x, z + 8)], 1.6, y_face + 22, y_face + 30)
    add(c, name.split(' (')[0] + (' — патрон лампы' if lamp else ' — контактный блок 1NO'), blk)


def din_device(c, x1, x2, z1, z2, yr, depth, name, levers=1, test=False):
    """Модульное устройство на DIN-рейку: ступенчатый профиль, рычажки, винтовые клеммы."""
    body = box(x1, yr, z1, x2, yr + depth, z2)
    body = body.cut(box(x1 - 1, yr + 45, z1 - 1, x2 + 1, yr + depth + 1, z1 + 17))      # ступень снизу
    body = body.cut(box(x1 - 1, yr + 45, z2 - 17, x2 + 1, yr + depth + 1, z2 + 1))      # ступень сверху
    body = holes(body, 'z', [((x1 + x2) / 2, yr + 30)], 2.2, z2 - 8, z2 + 1)
    body = holes(body, 'z', [((x1 + x2) / 2, yr + 30)], 2.2, z1 - 1, z1 + 8)
    add(c, name, body)
    w = (x2 - x1) / levers
    for i in range(levers):
        lever = box(x1 + i * w + 4, yr + depth, (z1 + z2) / 2 - 4, x1 + (i + 1) * w - 4, yr + depth + 7, (z1 + z2) / 2 + 10)
        add(c, name.split(' (')[0] + ' — рычажок', lever)
    if test:
        add(c, name.split(' (')[0] + ' — кнопка ТЕСТ', cyl('y', (x2 - 8, (z1 + z2) / 2 + 20), 3, yr + depth, yr + depth + 2))
    for z in (z1 + 9, z2 - 9):
        for xi in range(levers):
            add(c, name.split(' (')[0] + ' — винт клеммы', cyl('z', (x1 + w * xi + w / 2, yr + 30), 2.2, z - 1, z + 1))
    add(c, name.split(' (')[0] + ' — защёлка DIN', box(x1 + 2, yr - 2, z1 + 2, x2 - 2, yr, z1 + 14))


def psu_sdr(c, x1, x2, yr, z1, z2, depth):
    body = box(x1, yr, z1, x2, yr + depth, z2)
    slots = []
    for i in range(14):
        zz = z1 + 10 + i * 7.5
        slots += [(x1 - 1, zz, x1 + 1, zz + 3, yr + 20, yr + depth - 20), (x2 - 1, zz, x2 + 1, zz + 3, yr + 20, yr + depth - 20)]
    body = slot_cuts(body, 'x', [(yr + 20, zz, yr + depth - 20, zz + 3, x1 - 1, x1 + 1) for zz in [z1 + 10 + i * 7.5 for i in range(14)]])
    body = slot_cuts(body, 'x', [(yr + 20, zz, yr + depth - 20, zz + 3, x2 - 1, x2 + 1) for zz in [z1 + 10 + i * 7.5 for i in range(14)]])
    add(c, 'Блок питания 24 В 5 А Mean Well SDR-120 (покупной) — корпус с вентиляцией', body)
    strip = box(x1 + 3, yr + depth, z1 + 6, x2 - 3, yr + depth + 10, z1 + 58)
    strip = holes(strip, 'y', [((x1 + x2) / 2, z1 + 10 + i * 7) for i in range(7)], 1.8, yr + depth + 7, yr + depth + 12)
    add(c, 'БП — клеммная колодка: L, N, PE, −V, −V, +V, +V', strip)
    for i, lbl in enumerate(('L', 'N', 'PE', '−V', '−V', '+V', '+V')):
        add(c, 'БП — винт клеммы %s' % lbl, cyl('y', ((x1 + x2) / 2, z1 + 10 + i * 7), 1.9, yr + depth + 8, yr + depth + 10.5))
    add(c, 'БП — индикатор DC OK (зелёный)', cyl('y', ((x1 + x2) / 2, z1 + 66), 1.5, yr + depth, yr + depth + 1.5))
    add(c, 'БП — потенциометр V.ADJ', cyl('y', ((x1 + x2) / 2, z1 + 74), 2.5, yr + depth, yr + depth + 2))
    add(c, 'БП — защёлка DIN', box(x1 + 6, yr - 2, z1 + 30, x2 - 6, yr, z1 + 70))


def tb6600(c, x1, x2, yp, z1, z2):
    body = box(x1, yp, z1, x2, yp + 36, z2)
    body = body.cut(box(x1 + 4, yp + 36 - 2, z1 + 4, x2 - 4, yp + 37, z1 + 20))         # окно DIP-переключателей
    add(c, 'Драйвер TB6600 4 А (покупной) — корпус 96×72×36 алюминий', body)
    for i in range(6):
        add(c, 'TB6600 — DIP-переключатель S%d (ток/микрошаг)' % (i + 1), box(x1 + 8 + i * 6, yp + 33, z1 + 9, x1 + 12 + i * 6, yp + 36.5, z1 + 15))
    fins = [box(x1 + 2 + i * 8, yp + 36, z1 + 24, x1 + 4 + i * 8, yp + 42, z2 - 2) for i in range(12)]
    add(c, 'TB6600 — рёбра радиатора', cq.Compound.makeCompound(fins))
    for side, labels, x in ((0, ('ENA−', 'ENA+', 'DIR−', 'DIR+', 'PUL−', 'PUL+'), x1 - 1), (1, ('B−', 'B+', 'A−', 'A+', 'GND', 'VCC'), x2 - 11)):
        strip = box(x, yp, z2 - 2, x + 12, yp + 36, z2 + 10)
        for i, lbl in enumerate(labels):
            yy = yp + 4 + i * 5.5
            strip = strip.cut(cyl('z', (x + 6, yy), 1.6, z2 + 6, z2 + 11))
            add(c, 'TB6600 — винт клеммы %s' % lbl, cyl('z', (x + 6, yy), 1.5, z2 + 7, z2 + 9.5))
        add(c, 'TB6600 — клеммная колодка %s' % ('управления' if side == 0 else 'силовая'), strip)
    add(c, 'TB6600 — индикатор POWER', cyl('y', (x1 + 30, z1 + 30), 1.5, yp + 36, yp + 37.5))
    add(c, 'TB6600 — индикатор ALARM', cyl('y', (x1 + 36, z1 + 30), 1.5, yp + 36, yp + 37.5))


def terminal_uk(c, x, yr, zc, name):
    body = box(x, yr, zc - 21, x + 6.2, yr + 35, zc + 21)
    body = body.cut(cyl('z', (x + 3.1, yr + 26), 1.4, zc + 14, zc + 22)).cut(cyl('z', (x + 3.1, yr + 26), 1.4, zc - 22, zc - 14))
    body = body.cut(cyl('y', (x + 3.1, zc + 16), 1.6, yr + 34, yr + 36)).cut(cyl('y', (x + 3.1, zc - 16), 1.6, yr + 34, yr + 36))
    add(c, name, body)
    add(c, name.split(' (')[0] + ' — винт верх', cyl('z', (x + 3.1, yr + 26), 1.3, zc + 19, zc + 20.5))
    add(c, name.split(' (')[0] + ' — винт низ', cyl('z', (x + 3.1, yr + 26), 1.3, zc - 20.5, zc - 19))


def relay_module(c, x, yr, z1, z2, name):
    body = box(x, yr, z1, x + 15.5, yr + 46, z2)
    body = body.cut(box(x + 2, yr + 46 - 1, z1 + 8, x + 13.5, yr + 47, z1 + 30))
    add(c, name, body)
    add(c, name.split(' (')[0] + ' — реле 24 В в сокете', box(x + 3, yr + 45, z1 + 9, x + 12.5, yr + 58, z1 + 29))
    add(c, name.split(' (')[0] + ' — светодиод', cyl('y', (x + 7.75, z1 + 36), 1.2, yr + 46, yr + 47.5))
    for zz in (z1 + 4, z2 - 4):
        for xx in (x + 4, x + 11.5):
            add(c, name.split(' (')[0] + ' — винт клеммы', cyl('z', (xx, yr + 20), 1.3, zz - 1, zz + 1))


def din_socket(c, x1, x2, yr, z1, z2):
    body = box(x1, yr, z1, x2, yr + 50, z2)
    body = body.cut(cyl('y', ((x1 + x2) / 2, (z1 + z2) / 2), 18, yr + 46, yr + 51))
    body = body.cut(cyl('y', ((x1 + x2) / 2 - 9.5, (z1 + z2) / 2), 2.5, yr + 30, yr + 51))
    body = body.cut(cyl('y', ((x1 + x2) / 2 + 9.5, (z1 + z2) / 2), 2.5, yr + 30, yr + 51))
    add(c, 'Розетка на DIN-рейку Schuko (покупная)', body)
    for s in (-1, 1):
        add(c, 'Розетка — заземляющий контакт', box((x1 + x2) / 2 - 2, yr + 44, (z1 + z2) / 2 + s * 15 - 1, (x1 + x2) / 2 + 2, yr + 50, (z1 + z2) / 2 + s * 15 + 1))


def pi_adapter(c, x, yr, z):
    body = cq.Workplane('XY').add(box(x - 16, yr + 50, z - 20, x + 16, yr + 82, z + 20)).edges('|Y').fillet(4).val()
    add(c, 'Адаптер Raspberry Pi 27 Вт USB-C (покупной)', body)
    for s in (-1, 1):
        add(c, 'Адаптер — штырь вилки', cyl('y', (x + s * 9.5, z), 2.3, yr + 32, yr + 50))


def gland_pg(c, x, y, z_top, size):
    r = 5.5 if size == 7 else 8
    add(c, 'Кабельный ввод PG%d — корпус' % size, hex_nut('z', (x, y), 10 if size == 7 else 14, z_top - 2, z_top + 5))
    dome = cq.Workplane('XY').circle(r).workplane(offset=6).circle(r - 2.5).loft().val().translate(V(x, y, z_top + 5))
    add(c, 'Кабельный ввод PG%d — обжимная гайка' % size, dome.cut(cyl('z', (x, y), 3.2, z_top + 4, z_top + 12)))
    add(c, 'Кабельный ввод PG%d — контргайка' % size, hex_nut('z', (x, y), 10 if size == 7 else 14, z_top - 6, z_top - 2))


def camera_detail(c, xc, zc, hood_top, hood_t):
    pcb = cq.Workplane('XY').rect(38, 38).extrude(1.6).edges('|Z').fillet(2).val()
    pcb = holes(pcb, 'z', [(sx * 15, sy * 15) for sx in (-1, 1) for sy in (-1, 1)], 1.25, -1, 3).translate(V(xc, 0, zc))
    add(c, 'Плата камеры Raspberry Pi Global Shutter (покупная) — 38×38, 4 отв. Ø2,5', pcb)
    mount = cyl('z', (xc, 0), 12.5, zc - 12, zc).cut(cyl('z', (xc, 0), 10, zc - 13, zc - 1))
    add(c, 'Камера — CS-посадка с резьбой 1″-32', mount)
    for k in range(6):
        add(c, 'Камера — виток резьбы CS', cyl('z', (xc, 0), 12.6, zc - 11 + k * 1.6, zc - 10.5 + k * 1.6).cut(cyl('z', (xc, 0), 12.2, zc - 12, zc)))
    add(c, 'Камера — матрица IMX296 1/2.9″', box(xc - 3.2, -2.7, zc - 1, xc + 3.2, 2.7, zc - 0.3))
    body = cyl('z', (xc, 0), 14.5, zc - 40, zc - 12)
    add(c, 'Объектив 6 мм CS F1.2 (покупной) — корпус', body)
    for z0, nm in ((zc - 27, 'кольцо фокуса'), (zc - 37, 'кольцо диафрагмы')):
        ring = cyl('z', (xc, 0), 16.2, z0, z0 + 5)
        ribs = [box(-0.5, -0.5, 0, 0.5, 0.5, 5).rotate(V(0, 0, 0), V(0, 0, 1), i * 10).translate(V(xc + 16.2 * math.cos(math.radians(i * 10)), 16.2 * math.sin(math.radians(i * 10)), z0)) for i in range(36)]
        add(c, 'Объектив — %s (накатка)' % nm, ring.fuse(cq.Compound.makeCompound(ribs)))
        add(c, 'Объектив — стопорный винт %s' % nm, cyl('x', (0, z0 + 2.5), 1.2, xc + 15, xc + 19))
    add(c, 'Объектив — передняя линза', cyl('z', (xc, 0), 11, zc - 42, zc - 40))
    add(c, 'Объектив — оправа передней линзы', cyl('z', (xc, 0), 14.5, zc - 43, zc - 42).cut(cyl('z', (xc, 0), 10.5, zc - 44, zc - 41)))
    add(c, 'Разъём CSI на плате камеры (22 pin)', box(xc - 11, 14, zc + 1.6, xc + 11, 19, zc + 4.1).cut(box(xc - 10, 15, zc + 2.6, xc + 10, 18.5, zc + 5)))


def led_bar(c, x0, x1, y, z, name):
    prof = box(x0, y - 8.5, z - 1, x1, y + 8.5, z + 7).cut(box(x0 - 1, y - 7.5, z, x1 + 1, y + 7.5, z + 8))
    add(c, name + ' — профиль 17×7 алюминий', prof)
    add(c, name + ' — лента COB 24 В', box(x0 + 2, y - 4, z, x1 - 2, y + 4, z + 1.2))
    add(c, name + ' — рассеиватель матовый', box(x0, y - 7.4, z + 5.5, x1, y + 7.4, z + 7))
    for x in (x0, x1 - 2):
        add(c, name + ' — заглушка', box(x, y - 8.5, z - 1, x + 2, y + 8.5, z + 7))


def load_cell(c, xf, z_bot, z_top):
    body = box(xf - 65, -15, z_bot, xf + 65, 15, z_top)
    body = body.cut(cyl('y', (xf - 14, (z_bot + z_top) / 2), 6, -16, 16)).cut(cyl('y', (xf + 14, (z_bot + z_top) / 2), 6, -16, 16))
    body = body.cut(box(xf - 14, -16, (z_bot + z_top) / 2 - 1.2, xf + 14, 16, (z_bot + z_top) / 2 + 1.2))
    body = holes(body, 'z', [(xf - 58, 0), (xf - 45, 0), (xf + 45, 0), (xf + 58, 0)], 2.6, z_bot - 1, z_top + 1)
    add(c, 'Тензодатчик одноточечный 3 кг (покупной) — алюминий, 2 отв. M5 с каждой стороны', body)
    add(c, 'Тензодатчик — герметик над тензорезисторами', box(xf - 10, -8, z_top, xf + 10, 8, z_top + 1))


def hx711(c, x1, y1, z0):
    pcb = box(x1, y1, z0, x1 + 34, y1 + 21, z0 + 1.6)
    pcb = holes(pcb, 'z', [(x1 + 3, y1 + 3), (x1 + 31, y1 + 18)], 1.5, z0 - 1, z0 + 3)
    add(c, 'Модуль HX711 (покупной) — плата 34×21', pcb)
    add(c, 'HX711 — микросхема HX711', box(x1 + 13, y1 + 7, z0 + 1.6, x1 + 21, y1 + 14, z0 + 3.2))
    for i, lbl in enumerate(('E+', 'E−', 'A−', 'A+', 'B−', 'B+')):
        add(c, 'HX711 — клемма %s' % lbl, cyl('z', (x1 + 4 + i * 2.54, y1 + 18.5), 0.4, z0 + 1.6, z0 + 8))
    for i, lbl in enumerate(('GND', 'DT', 'SCK', 'VCC')):
        add(c, 'HX711 — штырёк %s' % lbl, cyl('z', (x1 + 4 + i * 2.54, y1 + 2.5), 0.4, z0 + 1.6, z0 + 8))


def ferrule(c, p, d, name):
    add(c, name, cyl('z', (p[0], p[1]), 0.9, p[2] - 4, p[2] + 2).rotate(V(*p), V(p[0] + 1, p[1], p[2]), 0))


def wire(c, pts, r, name):
    add(c, name, H_cable(pts, r))


# ============================ обогащение модели ============================
def enrich(P, L):
    """Замена упрощённых тел подробными и добавление недостающего."""
    zt = L['z_plate_top']
    za, bl = L['z_axle'], P['belt_len']
    y_in = P['belt_w'] / 2 + 10
    y_out = y_in + P['side_t']
    xm, zm = bl - 120, za - 110

    # --- привод
    drop('Шаговый двигатель NEMA23 (покупной)'); drop('Вал двигателя'); drop('Задняя крышка двигателя'); drop('Вывод кабеля двигателя')
    nema23('Привод и ролики — детали', xm, zm, P)
    drop('Подшипник 608ZZ')
    for x in (0, bl):
        for s in (-1, 1):
            bearing_608('Ленточный конвейер %g×%g' % (P['belt_w'], bl), x, za, s * y_in if s < 0 else y_in, s * y_out if s < 0 else y_out)
    # боковины с отверстиями и пазом натяжения
    for part in H.PARTS:
        if part['name'].startswith('Боковина'):
            s = part['shape']
            s = s.cut(box(-40, -200, za - 11, 10, 200, za + 11))                            # паз натяжения 50×22
            s = holes(s, 'y', [(bl, za)], 11.1, -200, 200)                                   # посадка подшипника
            s = holes(s, 'y', [(x, z) for x in (40, bl - 40) for z in (za - 25, za + 25)], 4.3, -200, 200)   # M8 стоек
            s = holes(s, 'y', [(x, L['z_belt_top'] + P['guide_h'] / 2) for x in (P['tub_len'] + 30, (P['tub_len'] + bl) / 2, bl - 60)], 2.2, -200, 200)
            part['shape'] = s
            part['name'] += ', паз натяжения 50×22, посадка Ø22, отв. M8 и M4'
    # шайбы под головки всех болтов и гайки на натяжении
    for part in list(H.PARTS):
        n = part['name']
        if n.startswith('Болт M8×30 боковина'):
            bb = part['shape'].BoundingBox()
            s = 1 if bb.ymin > 0 else -1
            add('Привод и ролики — детали', 'Шайба M8', washer('y', ((bb.xmin + bb.xmax) / 2, (bb.zmin + bb.zmax) / 2), 8, s * (y_in - 1.6), s * y_in))
    for s in (-1, 1):
        add('Привод и ролики — детали', 'Гайка M6 натяжения', hex_nut('x', (s * (y_out + 7.5), za), 6, -46, -41))
        add('Привод и ролики — детали', 'Шайба M6 натяжения', washer('x', (s * (y_out + 7.5), za), 6, -41, -39.5))

    # --- серва, весы, HX711
    drop('Сервопривод DS3218 PRO (покупной) — корпус'); drop('Сервопривод — фланец'); drop('Вал сервопривода'); drop('Качалка сервопривода')
    sw, sd, sh = P['servo']
    xh, zh = L['x_funnel'] - 38, L['z_funnel_bot'] - 2 - P['gate_t'] / 2.0
    servo_ds3218('Серва заслонки и весы — детали', xh, zh, sw, sd, sh)
    drop('Тензодатчик 3 кг (покупной)')
    xf = L['x_funnel']
    z_cup_bot = L['z_funnel_bot'] - 2 - P['gate_t'] - 10 - P['cup_h']
    z_cell_top = z_cup_bot - P['platform_t']
    load_cell('Серва заслонки и весы — детали', xf, z_cell_top - P['cell_h'], z_cell_top)
    drop('Модуль HX711 (покупной)'); drop('HX711 — гребёнка')
    hx711('Серва заслонки и весы — детали', xf - 100, -70, zt + 3)
    # жилы тензодатчика к клеммам HX711
    for i, (lbl, col) in enumerate((('E+', 'красный'), ('E−', 'чёрный'), ('A−', 'белый'), ('A+', 'зелёный'))):
        wire('Кабели и коммутация', [(xf - 90 + 10, -62, zt + 9), (xf - 96 + i * 2.54, -56, zt + 10), (xf - 96 + i * 2.54, -51.5, zt + 9)], 0.6,
             'Жила тензодатчика %s: кабель → HX711 клемма %s' % (col, lbl))

    # --- камера
    drop('Плата камеры Raspberry Pi Global Shutter'); drop('Камера Raspberry Pi Global Shutter — CS'); drop('Объектив 6 мм CS F1.2 — корпус')
    drop('Объектив — кольцо'); drop('Объектив — передняя линза'); drop('Разъём CSI на плате камеры')
    xc = (L['x_hood0'] + L['x_hood1']) / 2.0
    camera_detail('Камера и объектив', xc, L['z_cam'], L['z_hood_top'], P['hood_t'])

    # --- Pi
    bx0 = xc - 55; by0 = P['hood_y'] / 2.0; t = 2.5
    px0, pz0 = bx0 + 12, (L['z_cam'] - 190) + 12
    py = by0 + t + 6
    for pat in ('Raspberry Pi 5 8 ГБ (покупной) — плата', 'Порт Ethernet', 'Порты USB', 'Порт USB-C', 'Порт micro-HDMI', 'Разъёмы CSI/DSI',
                'Гребёнка GPIO', 'Активный кулер', 'Крыльчатка кулера', 'Стойка M2.5×6 платы Pi'):
        drop(pat)
    rpi5('Камера и объектив', px0, py, pz0, by0, t)

    # --- дисплей
    dw, dh, dt = P['display']
    xd, zd = P['display_x'], P['display_z']
    yb = P['frame_cy'] - P['frame_l'] / 2.0 - 30
    for pat in ('Дисплей 7″ 1024×600', 'Дисплей — активная область', 'Дисплей — плата', 'Дисплей — разъём'):
        drop(pat)
    display7('Дисплей оператора', xd, yb, zd, dw, dh, dt)

    # --- кнопочный пост
    yfr = P['frame_cy'] - P['frame_l'] / 2.0
    for pat in ('Кнопка аварийного стопа', 'Аварийный стоп', 'Кольцо жёлтое', 'Контактный блок', 'Кнопка Пуск', 'Кнопка Стоп', 'Лампа сигнальная', 'Патрон лампы'):
        drop(pat)
    estop('Кнопочный пост', 750, yfr - 3, zt + 50)
    pushbutton('Кнопочный пост', 730, yfr - 3, zt + 15, 'Кнопка Пуск зелёная (покупная)')
    pushbutton('Кнопочный пост', 770, yfr - 3, zt + 15, 'Кнопка Стоп красная (покупная)')
    pushbutton('Кнопочный пост', 750, yfr - 3, zt + 85, 'Лампа сигнальная 24 В зелёная (покупная)', lamp=True)
    for part in H.PARTS:
        if part['name'].startswith('Панель кнопок — сталь'):
            part['shape'] = holes(part['shape'], 'y', [(750, zt + 50)], 11.2, yfr - 5, yfr + 2)
            part['shape'] = holes(part['shape'], 'y', [(730, zt + 15), (770, zt + 15), (750, zt + 85)], 11.2, yfr - 5, yfr + 2)
            part['name'] += ', отв. Ø22,3 ×4'

    # --- шкаф: устройства
    cab = 'Шкаф управления 400×300×150'
    yp = 260 + 1.5 + 2; yr = yp + 7.5
    for pat in ('Автомат 1P', 'Дифавтомат 2P', 'Блок питания 24 В 5 А Mean Well', 'Реле-модуль', 'Розетка на DIN-рейку', 'Адаптер Raspberry Pi 27',
                'Клемма проходная', 'Концевой фиксатор', 'Драйвер TB6600', 'Кабельный ввод', 'Гайка кабельного ввода'):
        drop(pat)
    din_device(cab, 320, 338, 517, 597, yr, 65, 'Автомат 1P 10 А C (покупной)')
    din_device(cab, 342, 378, 517, 597, yr, 65, 'Дифавтомат 2P 16 А 30 мА (покупной)', levers=2, test=True)
    psu_sdr(cab, 385, 425, yr, 495, 620, 114)
    relay_module(cab, 432, yr, 530, 600, 'Реле K1 аварийной цепи 24 В (покупное)')
    relay_module(cab, 450, yr, 530, 600, 'Реле K2 пуска/лампы 24 В (покупное)')
    din_socket(cab, 470, 505, yr, 522, 592)
    pi_adapter(cab, 487, yr, 560)
    for i in range(16):
        terminal_uk(cab, 320 + i * 6.2, yr, 437, 'Клемма %d (покупная)' % (i + 1))
    add(cab, 'Концевой фиксатор клемм', box(316, yr, 412, 320, yr + 36, 462))
    add(cab, 'Концевой фиксатор клемм', box(320 + 16 * 6.2 + 1, yr, 412, 320 + 16 * 6.2 + 5, yr + 36, 462))
    tb6600(cab, 560, 656, yp, 400, 472)
    for x in (488, 498, 508, 518, 528, 538):
        gland_pg(cab, x, 232, 650, 7)
    # перфорация монтажной панели и отверстие двери: петли и дверь, открытая на 110°

    # --- подсветка
    drop('LED-планка А 24 В'); drop('LED-планка Б 24 В')
    zl = L['z_belt_top'] + 150
    hy = P['hood_y'] / 2.0
    for s, nm in ((-1, 'LED-планка А'), (1, 'LED-планка Б')):
        led_bar('Капот камеры и подсветка', L['x_hood0'] + 30, L['x_hood0'] + 30 + P['led_len'], s * (hy - 30), zl, nm)

    # --- отверстия в плитах
    for part in H.PARTS:
        n = part['name']
        if n.startswith('Плита стенда'):
            pts = [(x + dx, s * (y_out + 20)) for x in (40, bl - 40) for s in (-1, 1) for dx in (-12, 12)]
            pts += [(xf + sx, 0) for sx in (-58, -45)]
            pts += [(x, s * (P['funnel_top_y'] / 2 + 12)) for s in (-1, 1) for x in (xf - P['funnel_top_x'] / 2 + 10, xf + P['funnel_top_x'] / 2 - 10)]
            part['shape'] = holes(part['shape'], 'z', pts, 4.3, zt - 10, zt + 1)
            part['name'] += ', отв. Ø8,5 под стойки и весы'
        if n.startswith('Опорная пластина ленты'):
            part['shape'] = holes(part['shape'], 'z', [(x, s * 60) for x in (100, 350, 600) for s in (-1, 1)], 2.2, 900, 1000)
            part['name'] += ', 6 отв. M4'
        if n.startswith('[3D] Планка-ограничитель'):
            part['shape'] = slot_cuts(part['shape'], 'x', [(s * (P['belt_w'] / 2 + 4) - 2.5, L['z_belt_top'] + 20, s * (P['belt_w'] / 2 + 4) + 2.5, L['z_belt_top'] + 60, 190, 210) for s in (-1, 1)])
            part['name'] += ', пазы регулировки 5×40'
        if n.startswith('Стенка капота'):
            bb = part['shape'].BoundingBox()
            zs = (bb.zmin + bb.zmax) / 2
            part['shape'] = slot_cuts(part['shape'], 'y', [(L['x_hood0'] + 40 + i * 30, zs + 60, L['x_hood0'] + 60 + i * 30, zs + 120, bb.ymin - 1, bb.ymax + 1) for i in range(6)])
            part['name'] += ', вентиляционные прорези 20×60 ×6'
    # дверца капота со стороны оператора (−Y), петли и ручка
    x0h, x1h = L['x_hood0'], L['x_hood1']
    zb_h, zt_h = L['z_belt_top'] - 60, L['z_hood_top']
    for part in H.PARTS:
        if part['name'].startswith('Стенка капота А'):
            part['shape'] = part['shape'].cut(box(x0h + 30, -hy - 1, zb_h + 90, x1h - 30, -hy + 10, zt_h - 40))
            part['name'] += ', проём дверцы'
    door = box(x0h + 28, -hy - P['hood_t'] - 0.5, zb_h + 88, x1h - 28, -hy - 0.5, zt_h - 38)
    add('Капот камеры и подсветка', 'Дверца капота — ПВХ 3 мм, на петлях (закрыта)', door)
    for z in (zb_h + 110, zt_h - 60):
        add('Капот камеры и подсветка', 'Петля дверцы капота', cyl('z', (x0h + 30, -hy - P['hood_t'] - 2), 3, z - 12, z + 12))
    add('Капот камеры и подсветка', 'Ручка дверцы капота', box(x1h - 45, -hy - P['hood_t'] - 10, (zb_h + zt_h) / 2 - 20, x1h - 37, -hy - P['hood_t'] - 0.5, (zb_h + zt_h) / 2 + 20))
    add('Капот камеры и подсветка', 'Магнитная защёлка дверцы', box(x1h - 36, -hy - 1, (zb_h + zt_h) / 2 - 8, x1h - 30, -hy + 2, (zb_h + zt_h) / 2 + 8))

    # --- перфорация кабель-каналов (прорези на стенках)
    for part in H.PARTS:
        n = part['name']
        if n.startswith('Кабель-канал') and ('стенка' in n or 'борт' in n):
            bb = part['shape'].BoundingBox()
            lx, ly, lz = bb.xlen, bb.ylen, bb.zlen
            cuts = []
            if lx > 40 and lz > 10 and ly < 3:           # стенка вдоль X, тонкая по Y
                for x in range(int(bb.xmin) + 8, int(bb.xmax) - 8, 10):
                    cuts.append((x, bb.zmin + 3, x + 4, bb.zmax - 3, bb.ymin - 1, bb.ymax + 1))
                part['shape'] = slot_cuts(part['shape'], 'y', cuts)
            elif ly > 40 and lz > 10 and lx < 3:         # стенка вдоль Y, тонкая по X
                for y in range(int(bb.ymin) + 8, int(bb.ymax) - 8, 10):
                    cuts.append((y, bb.zmin + 3, y + 4, bb.zmax - 3, bb.xmin - 1, bb.xmax + 1))
                part['shape'] = slot_cuts(part['shape'], 'x', cuts)
            elif lz > 40 and lx < 3:                     # вертикальная стенка, тонкая по X
                for z in range(int(bb.zmin) + 8, int(bb.zmax) - 8, 10):
                    cuts.append((bb.ymin + 3, z, bb.ymax - 3, z + 4, bb.xmin - 1, bb.xmax + 1))
                part['shape'] = slot_cuts(part['shape'], 'x', cuts)
            if cuts:
                part['name'] += ' (перфорация 4×…)'

    # --- стяжки кабелей в магистрали и на капоте
    for y in (-150, -40, 60, 190):
        add('Кабели и коммутация', 'Стяжка нейлоновая 3,6×200', box(484, y, zt + 1.5, 536, y + 3.6, zt + 18).cut(box(485.5, y - 1, zt + 3, 534.5, y + 5, zt + 16.5)))
    for z in (800, 950, 1100):
        add('Кабели и коммутация', 'Стяжка нейлоновая 2,5×100', box(518, 121, z, 537, 136, z + 2.5).cut(box(519.5, 122.5, z - 1, 535.5, 134.5, z + 4)))

    # --- разделка кабелей по жилам с наконечниками (НШВИ) на клеммах шкафа и TB6600
    yw = yr + 30
    def fanout(cable_end, targets, r=0.6, prefix='Жила'):
        for (lbl, col, tgt) in targets:
            mid = ((cable_end[0] + tgt[0]) / 2, (cable_end[1] + tgt[1]) / 2, tgt[2] + 12)
            wire('Кабели и коммутация', [cable_end, mid, (tgt[0], tgt[1], tgt[2] + 6), tgt], r, '%s %s: %s' % (prefix, col, lbl))
            add('Кабели и коммутация', 'Наконечник НШВИ %s' % lbl.split(' →')[0], cyl('z', (tgt[0], tgt[1]), 1.0, tgt[2] - 1, tgt[2] + 5))
    # кабель двигателя: клеммы 5–8
    term = lambda i: (320 + (i - 1) * 6.2 + 3.1, yr + 26, 458)
    fanout((538, 232, 640), [('кабель двигателя → клемма 5 (A+)', 'красный', term(5)), ('кабель двигателя → клемма 6 (A−)', 'синий', term(6)),
                             ('кабель двигателя → клемма 7 (B+)', 'зелёный', term(7)), ('кабель двигателя → клемма 8 (B−)', 'чёрный', term(8))])
    # от клемм 5–8 к TB6600 силовой колодке
    tbp = lambda i: (656 - 11 + 6, yp + 4 + i * 5.5, 482)
    for i, (lbl, col, k) in enumerate((('A+', 'красный', 5), ('A−', 'синий', 6), ('B+', 'зелёный', 7), ('B−', 'чёрный', 8))):
        wire('Кабели и коммутация', [(term(k)[0], yr + 26, 416), (term(k)[0], yr + 26, 395), (tbp(3 - i)[0] - 20, tbp(3 - i)[1], 392), tbp(3 - i)], 0.7,
             'Провод 0,75 мм² — %s: клемма %d → TB6600 (%s)' % (col, k, lbl))
    # STEP/DIR/EN от ввода к колодке управления TB6600
    tbc = lambda i: (560 - 1 + 6, yp + 4 + i * 5.5, 482)
    fanout((518, 232, 640), [('STEP/DIR → TB6600 PUL−', 'белый', tbc(0)), ('STEP/DIR → TB6600 DIR−', 'зелёный', tbc(2)),
                             ('STEP/DIR → TB6600 ENA−', 'жёлтый', tbc(4)), ('STEP/DIR → TB6600 +5 В общий (PUL+, DIR+, ENA+)', 'красный', tbc(1))])
    # кабель кнопочного поста: клеммы 9–16
    fanout((488, 232, 640), [('пульт → клемма 9 (стоп NC1)', 'серый', term(9)), ('пульт → клемма 10 (стоп NC2)', 'серый', term(10)),
                             ('пульт → клемма 11 (пуск NO)', 'белый', term(11)), ('пульт → клемма 12 (стоп NC)', 'коричневый', term(12)),
                             ('пульт → клемма 13 (лампа +)', 'зелёный', term(13)), ('пульт → клемма 14 (лампа −)', 'чёрный', term(14)),
                             ('пульт → клемма 15 (общий 24 В)', 'красный', term(15)), ('пульт → клемма 16 (0 В)', 'синий', term(16))])
    # подсветка 24 В: ввод → диммер
    fanout((498, 232, 640), [('подсветка → диммер OUT+', 'красный', (530, yr + 10, 571)), ('подсветка → диммер OUT−', 'чёрный', (560, yr + 10, 571))], 0.7)
    # 24 В к модулю сервы: клеммы 1–2
    fanout((528, 232, 640), [('24 В сервы → клемма 1 (+24)', 'красный', term(1)), ('24 В сервы → клемма 2 (0 В)', 'чёрный', term(2))], 0.6)
    # ввод 220 В: L N PE
    fanout((312, 250, 400), [('220 В → автомат 1 (L вход)', 'коричневый', (329, yr + 30, 598)), ('220 В → дифавтомат N (вход)', 'синий', (369, yr + 30, 598)),
                             ('220 В → шина PE', 'жёлто-зелёный', (322, yr + 5, 601))], 1.0)
    # жилы в кнопочном посте: от контактных блоков к кабелю
    pb = (750, yfr + 25, zt + 50)
    for (lbl, col, tgt) in (('стоп NC1', 'серый', (744, yfr + 33, zt + 36)), ('стоп NC2', 'серый', (756, yfr + 33, zt + 36)),
                            ('пуск NO', 'белый', (730, yfr + 27, zt + 7)), ('стоп NC', 'коричневый', (770, yfr + 27, zt + 7)),
                            ('лампа +', 'зелёный', (750, yfr + 25, zt + 77)), ('лампа −', 'чёрный', (750, yfr + 25, zt + 93))):
        wire('Кнопочный пост', [pb, ((pb[0] + tgt[0]) / 2, yfr + 30, (pb[2] + tgt[2]) / 2), tgt], 0.6, 'Жила пульта %s: кабель → %s' % (col, lbl))
    return len(H.PARTS)
