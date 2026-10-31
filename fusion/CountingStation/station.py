# -*- coding: utf-8 -*-
"""Построители узлов счётной станции. Каждый узел — свой компонент, геометрия в мировых координатах (мм).

Система координат: ось чаши — начало координат, Z вверх, пол на Z=0.
Выход дорожки — на +X, выходной лоток идёт вдоль +Y, бункер и вибролоток — со стороны −Y.
"""
import math
import helpers as H
from helpers import (box, cylinder, square_tube, u_channel, frustum_shell,
                     rotate_bodies, helix_track, new_component, NEW, CUT)


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
    H.shell(c, body, [H.planar_faces_by_z(body)[-1]], P['bin_t'])
    return c


def build_scale(ctx, parent, P, L):
    c = new_component(parent, 'Стендовые весы')
    xe, yc = L['x_exit'], L['y_sensor'] - 30
    z_cup_top = L['z_flap_bot'] - 5
    z_cup_bot = z_cup_top - P['cup_h']
    f = cylinder(c, 'z', (xe, yc), P['cup_d'] / 2, z_cup_bot, z_cup_top, 'Ковш приёмный — AISI 304 1')
    body = f.bodies.item(0)
    H.shell(c, body, [H.planar_faces_by_z(body)[-1]], 1)
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
