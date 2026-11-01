# -*- coding: utf-8 -*-
"""Современный внешний вид станции: закрытый корпус с панелями и дверцами, кожухи ленты,
капот на алюминиевом профиле с окном, колёса и опоры, световая колонна, консоль кнопок.
Только CadQuery; вызывается после parts_cq.enrich. Координаты — мм, Z вверх."""
import math
import cadquery as cq
import cq_helpers as H
from parts_cq import add, drop, box, cyl, holes, hex_nut, orient, V


def rounded_box(x1, y1, z1, x2, y2, z2, r, axis='Z'):
    s = box(x1, y1, z1, x2, y2, z2)
    return cq.Workplane('XY').add(s).edges('|' + axis).fillet(r).val()


def modernize(P, L):
    zt = L['z_plate_top']
    cx, cy, w, l = P['frame_cx'], P['frame_cy'], P['frame_w'], P['frame_l']
    x1, x2, y1, y2 = cx - w / 2, cx + w / 2, cy - l / 2, cy + l / 2
    body = 'Корпус станции'
    T = 1.5

    # ---------- корпус: панели RAL 7035 с зазорами-ревелями, цоколь антрацит ----------
    zb = 120                                              # низ панелей над полом (цоколь)
    add(body, 'Корпус — передняя панель, сталь 1,5 RAL 7035', box(x1 + 6, y1 - 2 - T, zb, x2 - 6, y1 - 2, zt - 22))
    add(body, 'Корпус — боковая панель левая', box(x1 - 2 - T, y1 + 6, zb, x1 - 2, y2 - 6, zt - 22))
    add(body, 'Корпус — боковая панель правая', box(x2 + 2, y1 + 6, zb, x2 + 2 + T, y2 - 6, zt - 22))
    # задняя стенка: фиксированные части + дверца отсека электрики (открыта на 100°)
    add(body, 'Корпус — задняя панель, часть А', box(x1 + 6, y2 + 2, zb, 280, y2 + 2 + T, zt - 22))
    add(body, 'Корпус — задняя панель, часть Б', box(720, y2 + 2, zb, x2 - 6, y2 + 2 + T, zt - 22))
    add(body, 'Корпус — задняя панель, над дверцей', box(280, y2 + 2, zt - 90, 720, y2 + 2 + T, zt - 22))
    door = rounded_box(0, 0, 0, 436, T, zt - 92 - zb - 2, 6, 'Y').rotate(V(0, 0, 0), V(0, 0, 1), 100).translate(V(718, y2 + 3, zb + 1))
    add(body, 'Корпус — дверца отсека электрики 436×%g, открыта на 100°' % (zt - 92 - zb - 2), door)
    for z in (zb + 60, zt - 140):
        add(body, 'Петля дверцы корпуса', cyl('z', (719, y2 + 4), 4, z - 20, z + 20))
    lock = cyl('y', (0, (zt - 92 - zb) / 2), 7, -2, 6).translate(V(60, 0, zb + 1)).rotate(V(718, y2 + 3, 0), V(718, y2 + 3, 1), 100)
    add(body, 'Замок дверцы корпуса (четверть-оборот)', lock)
    # передняя дверца обслуживания (закрыта), с ручкой
    add(body, 'Корпус — передняя дверца обслуживания 500×400 (закрыта)', rounded_box(0, y1 - 2 - T - 2, zb + 60, 500, y1 - 2 - T - 0.5, zb + 460, 6, 'Y'))
    add(body, 'Ручка передней дверцы', box(420, y1 - 2 - T - 14, zb + 240, 480, y1 - 2 - T - 2, zb + 280).cut(box(428, y1 - 30, zb + 248, 472, y1, zb + 272)))
    # цоколь антрацит и верхняя кромка-обрамление
    add(body, 'Цоколь — сталь 2 RAL 7016', box(x1 + 20, y1 + 20, 60, x2 - 20, y2 - 20, zb).cut(box(x1 + 22, y1 + 22, 58, x2 - 22, y2 - 22, zb + 1)))
    rim = box(x1 - 4, y1 - 4, zt - 22, x2 + 4, y2 + 4, zt - 2).cut(box(x1 + 2, y1 + 2, zt - 23, x2 - 2, y2 - 2, zt - 1))
    add(body, 'Обрамление столешницы — профиль 20×20 RAL 7016', rim)
    # столешница из нержавейки поверх плиты, скруглённый передний край
    top = rounded_box(x1 - 4, y1 - 4, zt, x2 + 4, y2 + 4, zt + 2, 8, 'Z')
    top = top.cut(box(478, 218, zt - 1, 542, 248, zt + 3))                          # лючок кабелей
    add(body, 'Столешница — нержавейка 2 мм шлифованная, лючок 64×30', top)
    add(body, 'Лючок кабелей — втулка кромки', box(476, 216, zt - 2, 544, 250, zt + 4).cut(box(479, 219, zt - 3, 541, 247, zt + 5)))
    for part in H.PARTS:
        if part['name'].startswith('Плита стенда'):
            part['shape'] = part['shape'].cut(box(478, 218, zt - 10, 542, 248, zt + 3))
            part['name'] += ', лючок кабелей'

    # ---------- колёса с тормозом и регулируемые опоры ----------
    drop('Опора регулируемая M12')
    legs = [(cx + sx * (w / 2 - 30), cy + sy * (l / 2 - 30)) for sx in (-1, 1) for sy in (-1, 1)]
    for i, (lx, ly) in enumerate(legs):
        add(body, 'Колесо поворотное Ø75 с тормозом (покупное) — вилка', box(lx - 22, ly - 6, 40, lx + 22, ly + 6, 102).cut(box(lx - 18, ly - 7, 40, lx + 18, ly + 7, 90)))
        add(body, 'Колесо поворотное Ø75 — пластина', box(lx - 30, ly - 30, 100, lx + 30, ly + 30, 108))
        add(body, 'Колесо поворотное Ø75 — колесо полиуретан', cyl('y', (lx, 80), 37.5, ly - 11, ly + 11))
        add(body, 'Колесо — ступица', cyl('y', (lx, 80), 12, ly - 14, ly + 14))
        add(body, 'Колесо — педаль тормоза', box(lx + 20, ly - 10, 60, lx + 45, ly + 10, 70))
        fx = lx + (60 if sx_of(i) < 0 else -60)
        add(body, 'Опора регулируемая M12 с резиновой пятой (покупная)', cyl('z', (fx, ly), 25, 0, 10))
        add(body, 'Опора регулируемая — шток M12', cyl('z', (fx, ly), 6, 10, 108))
        add(body, 'Опора регулируемая — контргайка M12', hex_nut('z', (fx, ly), 12, 98, 108))

    # ---------- конвейер: кожухи ----------
    y_in = P['belt_w'] / 2 + 10
    y_out = y_in + P['side_t']
    bl, rr, za = P['belt_len'], P['roller_d'] / 2.0, L['z_axle']
    cover = box(40, -y_in + 1, za - rr - 14, bl - 40, y_in - 1, za - rr - 12)
    add('Ленточный конвейер %g×%g' % (P['belt_w'], bl), 'Кожух нижней ветви ленты — сталь 2 RAL 7016', cover)
    for s in (-1, 1):
        add('Ленточный конвейер %g×%g' % (P['belt_w'], bl), 'Кожух нижней ветви — отгиб', box(40, s * (y_in - 1) - (1 if s > 0 else 0), za - rr - 14, bl - 40, s * (y_in - 1) + (1 if s < 0 else 0), za - rr + 10))
    for x, nm in ((0, 'входной'), (bl, 'выходной')):
        guard = cyl('y', (x, za), rr + 8, -y_in, y_in).cut(cyl('y', (x, za), rr + 4, -y_in - 1, y_in + 1))
        guard = guard.cut(box(x - 40, -y_in - 1, za - 2, x + 40, y_in + 1, za + rr + 10))        # сверху открыт для ленты
        guard = guard.cut(box(x - 40 if x == 0 else x, -y_in - 1, za - rr - 10, x if x == 0 else x + 40, y_in + 1, za + 2))
        add('Ленточный конвейер %g×%g' % (P['belt_w'], bl), '[3D] Ограждение %s ролика (пальцезащита)' % nm, guard)
    # боковины: фаска сверху и анодирование — отмечаем в имени; торцевые крышки боковин
    for part in H.PARTS:
        if part['name'].startswith('Боковина'):
            try:
                part['shape'] = cq.Workplane('XY').add(part['shape']).edges('>Z').chamfer(1.5).val()
            except Exception:
                pass
            part['name'] = part['name'].replace('— алюминий 5', '— алюминий 5 анодированный')
    for s in (-1, 1):
        for x in (-rr - 20, bl + rr + 20):
            add('Ленточный конвейер %g×%g' % (P['belt_w'], bl), '[3D] Торцевая крышка боковины', box(x - (3 if x < 0 else 0), s * y_in if s < 0 else y_in, L['z_side_bot'], x + (3 if x > 0 else 0), s * y_out if s < 0 else y_out, L['z_side_top']).translate(V(0, 0, 0)))

    # ---------- капот: алюминиевый профиль 20×20, белые панели, окно, скруглённые углы ----------
    x0h, x1h = L['x_hood0'], L['x_hood1']
    hy = P['hood_y'] / 2.0
    zb_h, zt_h = L['z_belt_top'] - 60, L['z_hood_top']
    hood = 'Капот камеры и подсветка'
    drop('[3D] Угловой соединитель капота')
    for (x, y) in ((x0h + 10, -hy - 10), (x1h - 10, -hy - 10), (x0h + 10, hy + 10), (x1h - 10, hy + 10)):
        add(hood, 'Профиль алюминиевый 20×20 станочный — стойка капота', box(x - 10, y - 10, zb_h, x + 10, y + 10, zt_h).cut(box(x - 3, y - 3, zb_h - 1, x + 3, y + 3, zt_h + 1)))
    for z in (zb_h, zt_h - 20):
        add(hood, 'Профиль 20×20 — поперечина капота', box(x0h + 20, -hy - 20, z, x1h - 20, -hy, z + 20))
        add(hood, 'Профиль 20×20 — поперечина капота', box(x0h + 20, hy, z, x1h - 20, hy + 20, z + 20))
        add(hood, 'Профиль 20×20 — продольная капота', box(x0h, -hy, z, x0h + 20, hy, z + 20))
        add(hood, 'Профиль 20×20 — продольная капота', box(x1h - 20, -hy, z, x1h, hy, z + 20))
    for (x, y) in ((x0h + 10, -hy - 10), (x1h - 10, -hy - 10), (x0h + 10, hy + 10), (x1h - 10, hy + 10)):
        add(hood, '[3D] Угловая заглушка профиля', rounded_box(x - 11, y - 11, zt_h, x + 11, y + 11, zt_h + 8, 5, 'Z'))
    for part in H.PARTS:
        if part['name'].startswith('Стенка капота') or part['name'].startswith('Крыша капота') or part['name'].startswith('Торец капота'):
            part['name'] = part['name'].replace('ПВХ/АКП 3', 'алюминиевый композит 3 мм белый')
    # окно в дверце капота и оргстекло
    for part in H.PARTS:
        if part['name'].startswith('Дверца капота'):
            part['shape'] = part['shape'].cut(box(x0h + 55, -hy - 20, zb_h + 120, x1h - 55, -hy + 20, zt_h - 70))
            part['name'] = 'Дверца капота — композит белый, окно 150×%g (закрыта)' % (zt_h - 70 - zb_h - 120)
    add(hood, 'Окно дверцы капота — оргстекло 3 мм прозрачное', box(x0h + 50, -hy - P['hood_t'] - 0.4, zb_h + 115, x1h - 50, -hy - P['hood_t'] + 2.6, zt_h - 65))
    add(hood, 'Табличка «ЗОНА КАМЕРЫ · не открывать при работе»', box(x0h + 60, -hy - P['hood_t'] - 1.2, zt_h - 60, x1h - 60, -hy - P['hood_t'] - 0.4, zt_h - 42))
    # индикатор состояния на капоте: светодиодная полоса
    add(hood, 'Светодиодная полоса статуса (зелёный/красный) на капоте', box(x0h + 20, -hy - P['hood_t'] - 1.5, zt_h - 30, x1h - 20, -hy - P['hood_t'] - 0.3, zt_h - 24))

    # ---------- световая колонна ----------
    px, py = x2 - 60, y2 - 60
    add(body, 'Световая колонна — стойка Ø25 алюминий', cyl('z', (px, py), 12.5, zt + 2, zt + 200))
    add(body, 'Световая колонна — основание', cyl('z', (px, py), 30, zt + 2, zt + 12))
    for z, nm in ((zt + 200, 'зелёный'), (zt + 250, 'жёлтый'), (zt + 300, 'красный')):
        add(body, 'Световая колонна (покупная) — сегмент %s' % nm, cyl('z', (px, py), 25, z, z + 48))
    add(body, 'Световая колонна — крышка', cyl('z', (px, py), 26, zt + 348, zt + 356))
    H.PARTS.append({'comp': 'Кабели и коммутация', 'name': 'Кабель световой колонны 4×0,5 — серый: реле K2 (клеммы 13–14) → колонна',
                    'shape': _cable([(px, py, zt + 2), (px, py, zt - 20), (px, 232, zt - 20), (540, 232, zt - 20), (540, 232, zt - 50)], 2.0)})

    # ---------- консоль кнопок: антрацитовый корпус со скосом ----------
    yfr = P['frame_cy'] - P['frame_l'] / 2.0
    add('Кнопочный пост', 'Консоль кнопочного поста — корпус RAL 7016 со скруглением', rounded_box(708, yfr - 8, zt + 2, 792, yfr + 34, zt + 106, 6, 'Y').cut(box(712, yfr - 4, zt - 1, 788, yfr + 33, zt + 102)))
    return len(H.PARTS)


def sx_of(i):
    return -1 if i < 2 else 1


def _cable(pts, r):
    verts = [V(*p) for p in pts]
    wire = cq.Wire.makePolygon(verts)
    plane = cq.Plane(origin=verts[0], normal=(verts[1] - verts[0]).normalized())
    return cq.Workplane(plane).circle(r).sweep(cq.Workplane('XY').add(wire), transition='round').val()
