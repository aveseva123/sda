# -*- coding: utf-8 -*-
"""Визуальная счётная станция (камера + ИИ, лента) — скрипт Fusion 360.

Строит параметрическую сборку прототипа: рама стенда, ленточный конвейер 150×700 с приводом NEMA23,
загрузочный лоток и планка-ограничитель слоя, капот с камерой Raspberry Pi и LED-подсветкой,
воронка с заслонкой на сервоприводе, стендовые весы, дисплей и электроника.
Детали с пометкой [3D] печатаются на 3D-принтере.

Запуск: Fusion 360 → Utilities → Scripts and Add-Ins → Scripts → «+» → эта папка → Run.
Размеры правятся в params.py. Повторный запуск строит новую сборку рядом со старой.
"""
import os
import sys
import importlib
import traceback

import adsk.core
import adsk.fusion

EXPORT_DXF = False          # True — выгрузить эскизы плоских деталей в out/dxf рядом со скриптом

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import params      # noqa: E402
import helpers     # noqa: E402
import station     # noqa: E402
for _m in (params, helpers, station):
    importlib.reload(_m)


def run(context):
    ui = None
    try:
        ctx = helpers.Ctx()
        ui = ctx.ui
        P = params.P
        L = params.layout(P)
        helpers.FLAT_SKETCHES.clear()

        top = helpers.new_component(ctx.root, 'Визуальная счётная станция — лента %g×%g' % (P['belt_w'], P['belt_len']))
        errors = []

        def step(name, fn, *args):
            try:
                return fn(ctx, top, P, L, *args)
            except Exception:
                errors.append('%s: %s' % (name, traceback.format_exc().strip().splitlines()[-1]))
                return None

        step('Рама стенда', station.build_frame)
        step('Конвейер', station.build_conveyor)
        step('Загрузка', station.build_loading)
        step('Капот камеры', station.build_hood)
        step('Выход и весы', station.build_outlet)
        step('Электроника', station.build_electronics)

        fov_x = 250.0 * P['cam_height'] / 300.0
        notes = [
            'Верх ленты: %.0f мм от пола' % L['z_belt_top'],
            'Камера на %g мм над лентой, поле кадра ≈ %.0f×%.0f мм (объектив 6 мм)' % (P['cam_height'], fov_x, fov_x * 0.75),
            'Скорость ленты %g мм/с → деталь в кадре ≈ %.1f с' % (P['conv_speed'], fov_x / P['conv_speed']),
            'Верх капота: %.0f мм от пола' % L['z_hood_top'],
        ]
        if EXPORT_DXF:
            files = helpers.export_dxf(ctx, os.path.join(HERE, 'out', 'dxf'))
            notes.append('DXF плоских деталей: %d файлов в out/dxf' % len(files))

        ctx.app.activeViewport.fit()
        msg = 'Визуальная счётная станция построена.\n\n' + '\n'.join(notes)
        if errors:
            msg += '\n\nНе построены (остальное на месте):\n' + '\n'.join(errors)
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox('Ошибка скрипта:\n' + traceback.format_exc())
