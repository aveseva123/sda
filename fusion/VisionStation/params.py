# -*- coding: utf-8 -*-
"""Параметры визуальной счётной станции (камера + ИИ, лента). Размеры в мм.

Схема: оператор высыпает детали в загрузочный лоток на старте ленты → планка-ограничитель
выравнивает слой → лента 150 мм → капот с камерой и подсветкой (счёт на проходе) →
сброс с конца ленты в воронку → заслонка на сервоприводе → пакет / ковш на весах.

Ось ленты — X (движение в +X), Z вверх, пол на Z = 0. Начало координат — передний (входной) ролик ленты.
Детали с пометкой [3D] печатаются на 3D-принтере (PETG), остальное — лист, профиль, покупное.
"""
import math

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
