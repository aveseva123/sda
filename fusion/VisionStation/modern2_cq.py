# -*- coding: utf-8 -*-
"""Промышленный «модерн»: цельная оболочка корпуса с радиусами 15 мм и чистыми швами, дверцы как сегменты
оболочки, антрацитовая юбка и декоративная линия, столешница из нержавейки, стойка HMI с кронштейном,
наклонный пульт с кнопками, капот на профиле (из modern_cq) остаётся. Только CadQuery."""
import cadquery as cq
import cq_helpers as H
from parts_cq import add, drop, box, cyl, hex_nut, V

loc = lambda x, y, z: cq.Location(V(x, y, z))


def rr(w, h, r):
    return cq.Sketch().rect(w, h).vertices().fillet(r)


def prism(x, y, z1, z2, w, h, r):
    return cq.Workplane('XY').placeSketch(rr(w, h, r).moved(loc(x, y, z1))).extrude(z2 - z1).val()


def industrialize(P, L):
    zt = L['z_plate_top']
    cx = P['frame_cx']
    for pat in ('Корпус — ', 'Петля дверцы корпуса', 'Замок дверцы корпуса', 'Ручка передней дверцы', 'Цоколь', 'Обрамление столешницы',
                'Столешница', 'Лючок кабелей', 'Консоль кнопочного поста', 'Стойка дисплея', '[3D] Кронштейн дисплея', 'Болт M6×20 кронштейна дисплея'):
        drop(pat)
    body = 'Корпус станции'
    W, D, R = 1320, 540, 15
    outer = prism(cx, 0, 60, zt - 8, W, D, R)
    outer = cq.Workplane('XY').add(outer).edges('>Z').fillet(6).val()
    inner = prism(cx, 0, 55, zt + 10, W - 3, D - 3, R - 1.5)
    skin = outer.cut(inner)
    # декоративная линия-паз 3 мм на высоте 2/3 и у низа
    for z in (450, 150):
        skin = skin.cut(box(-900, -900, z - 1.5, 1400, 900, z + 1.5))
    # задняя дверца отсека электрики (сегмент), открыта на 100°; передняя сервисная дверца (сегмент), закрыта
    reg = box(280, 200, 160, 720, 400, 640)
    door = skin.intersect(reg)
    skin = skin.cut(box(278, 200, 158, 722, 400, 642))
    door = door.rotate(V(720, 268, 0), V(720, 268, 1), -100)
    regf = box(-20, -400, 160, 480, -200, 640)
    fdoor = skin.intersect(regf)
    skin = skin.cut(box(-22, -400, 158, 482, -200, 642))
    add(body, 'Оболочка корпуса — сталь 1,5 мм, порошковая окраска RAL 7035, радиусы 15, швы 2 мм', skin)
    add(body, 'Дверца отсека электрики — сегмент оболочки, открыта на 100°', door)
    add(body, 'Сервисная дверца передняя — сегмент оболочки (закрыта)', fdoor)
    add(body, 'Ручка сервисной дверцы — скоба нержавейка', box(380, -282, 380, 440, -272, 420).cut(box(388, -290, 388, 432, -268, 412)))
    for z in (220, 580):
        add(body, 'Петля дверцы отсека электрики', cyl('z', (720, 270), 5, z - 25, z + 25))
        add(body, 'Петля сервисной дверцы', cyl('z', (-20, -270), 5, z - 25, z + 25))
    add(body, 'Замок дверцы отсека (четверть-оборот, ключ)', cyl('y', (0, 400), 7, 0, 10).translate(V(300, 268, 0)).rotate(V(720, 268, 0), V(720, 268, 1), -100))
    add(body, 'Вентиляционная решётка отсека электрики с фильтром 120×120', box(100, 266, 250, 220, 274, 370).cut(box(108, 260, 258, 212, 280, 362)))
    add(body, 'Вентилятор отсека 120 мм (покупной)', cyl('y', (160, 310), 55, 240, 266))
    add(body, 'Табличка изготовителя — нержавейка 120×60', box(760, -272, 560, 880, -270, 620))
    skirt_o = prism(cx, 0, 22, 62, W - 60, D - 60, R)
    skirt_i = prism(cx, 0, 20, 64, W - 64, D - 64, R - 2)
    add(body, 'Юбка корпуса — антрацит RAL 7016, закрывает колёса', skirt_o.cut(skirt_i))
    deck = prism(cx, 0, zt, zt + 3, W + 12, D + 12, 22)
    deck = deck.cut(box(478, 218, zt - 1, 542, 248, zt + 4))
    add(body, 'Столешница — нержавейка 3 мм шлифованная, радиус 22, лючок кабелей', deck)
    add(body, 'Лючок кабелей — рамка нержавейка', box(474, 214, zt + 3, 546, 252, zt + 6).cut(box(478, 218, zt + 2, 542, 248, zt + 7)))
    for part in H.PARTS:
        if part['name'].startswith('Плита стенда') and 'лючок' not in part['name']:
            part['shape'] = part['shape'].cut(box(478, 218, zt - 10, 542, 248, zt + 3))
            part['name'] += ', лючок кабелей'
    # крышки кабель-каналов на столешнице лежат рядом (сняты для показа)
    # ---------- стойка HMI с кронштейном ----------
    disp = 'Дисплей оператора'
    xd, zd = P['display_x'], P['display_z']
    dw, dh, dt = P['display']
    yfr = P['frame_cy'] - P['frame_l'] / 2.0
    yb = yfr - 30
    add(disp, 'Стойка HMI — труба Ø40 нержавейка', cyl('z', (xd, yfr + 20), 20, zt + 3, zd + dh / 2 + 40))
    add(disp, 'Стойка HMI — фланец крепления Ø90 с 4 болтами', cyl('z', (xd, yfr + 20), 45, zt + 3, zt + 11))
    for a in (45, 135, 225, 315):
        import math
        add(disp, 'Болт M8 фланца стойки', cyl('z', (xd + 35 * math.cos(math.radians(a)), yfr + 20 + 35 * math.sin(math.radians(a))), 4, zt + 11, zt + 17))
    add(disp, 'Кронштейн HMI — консоль поворотная 50×30 нержавейка', box(xd - 15, yb + 12, zd + dh / 2 - 25, xd + 15, yfr + 40, zd + dh / 2 + 25))
    add(disp, 'Шарнир наклона дисплея Ø40', cyl('x', (yb + 12, zd + dh / 2), 20, xd - 25, xd + 25))
    add(disp, 'Хомут стойки HMI (поворот)', cyl('z', (xd, yfr + 20), 26, zd + dh / 2 - 30, zd + dh / 2 + 30))
    back = cq.Workplane('XY').add(box(xd - dw / 2 + 6, yb, zd + 6, xd + dw / 2 - 6, yb + 12, zd + dh - 6)).edges('|Y').fillet(10).val()
    add(disp, 'Задняя крышка дисплея — ABS, скруглённая, ввод кабелей', back.cut(box(xd - 64, yb - 1, zd + 26, xd + 64, yb + 10, zd + 94)))
    # ---------- наклонный пульт: кнопки поворачиваются на 30° назад вокруг нижней кромки панели ----------
    pivot_z = zt + 3
    for part in H.PARTS:
        if part['comp'] == 'Кнопочный пост':
            part['shape'] = part['shape'].rotate(V(0, yfr - 3, pivot_z), V(1, yfr - 3, pivot_z), -30)
    wedge = box(700, yfr - 4, zt + 3, 800, yfr + 70, zt + 118)
    cutter = box(690, yfr - 200, zt - 100, 810, yfr + 200, zt + 400).rotate(V(0, yfr - 3, pivot_z), V(1, yfr - 3, pivot_z), -30)
    pod = wedge.intersect(cutter.translate(V(0, 0, 0)))
    pod = pod.cut(box(712, yfr - 4, zt + 2, 788, yfr + 60, zt + 100).rotate(V(0, yfr - 3, pivot_z), V(1, yfr - 3, pivot_z), -30))
    try:
        pod = cq.Workplane('XY').add(pod).edges('|Z').fillet(8).val()
    except Exception:
        pass
    add('Кнопочный пост', 'Пульт наклонный 30° — нержавейка, с лицевой панелью под 4 аппарата Ø22', pod)
    add('Кнопочный пост', 'Пульт — пиктограммы и надписи (лазерная гравировка)', box(718, yfr - 4.5, zt + 95, 782, yfr - 3.6, zt + 101).rotate(V(0, yfr - 3, pivot_z), V(1, yfr - 3, pivot_z), -30))
    # ---------- воронка и приёмник: нержавейка ----------
    for part in H.PARTS:
        if part['name'].startswith('[3D] Воронка'):
            part['name'] = 'Воронка — нержавейка 1 мм, сварная, полировка (вместо печати)'
        if part['name'].startswith('[3D] Ковш'):
            part['name'] = 'Ковш приёмный — нержавейка 1 мм'
    return len(H.PARTS)
