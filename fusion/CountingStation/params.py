# -*- coding: utf-8 -*-
"""Параметры счётной станции (прототип, чаша Ø300). Все размеры в мм, углы в градусах.

Меняете значения здесь и запускаете скрипт заново — он строит новую сборку.
Источник требований: ТЗ «Линия счёта и фасовки метизов», раздел «Счётная станция».
"""
import math

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
