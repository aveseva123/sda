# -*- coding: utf-8 -*-
"""Построители узлов визуальной счётной станции. Каждый узел — свой компонент, геометрия в мировых мм.

Ось ленты — X (движение в +X), Z вверх, пол на Z = 0, начало координат — ось входного ролика.
Тела с пометкой [3D] печатаются на 3D-принтере.
"""
import math
from helpers import (box, cylinder, square_tube, u_channel, frustum_shell, shell,
                     planar_faces_by_z, new_component, NEW, CUT)


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
