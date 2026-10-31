# -*- coding: utf-8 -*-
"""Счётная станция линии фасовки метизов — скрипт Fusion 360.

Строит параметрическую сборку прототипа станции (этап 2 ТЗ): рама стенда, вибропривод,
чаша Ø300 со спиральной дорожкой и выходным лотком, счётная зона со стоп-штифтом,
накопитель с перекидной заслонкой, стендовые весы, бункер-дозагрузчик с вибролотком.

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

        top = helpers.new_component(ctx.root, 'Счётная станция — чаша Ø%g' % P['bowl_d'])
        errors = []

        def step(name, fn, *args):
            try:
                return fn(ctx, top, P, L, *args)
            except Exception:
                errors.append('%s: %s' % (name, traceback.format_exc().strip().splitlines()[-1]))
                return None

        step('Рама стенда', station.build_frame)
        step('Вибропривод', station.build_drive)
        bowl = step('Виброчаша', station.build_bowl)
        if bowl:
            step('Счёт и стоп-штифт', station.build_counter, bowl['chute'])
        step('Накопитель', station.build_accumulator)
        step('Стендовые весы', station.build_scale)
        step('Бункер и вибролоток', station.build_hopper)
        step('Датчик уровня', station.build_level_sensor)

        gap = (L['z_top_plate_bot'] - P['armature_t']) - (L['z_mass_top'] + P['magnet_h'])
        notes = [
            'Высота кромки чаши: %.0f мм от пола' % L['z_rim'],
            'Высота выхода дорожки: %.0f мм' % L['z_track_exit'],
            'Воздушный зазор электромагнита: %.1f мм (цель %g; регулируется прокладками под якорь)' % (gap, P['air_gap']),
            'Верх бункера: %.0f мм от пола' % (L['z_hopper_bot'] + P['hopper_h']),
        ]
        if EXPORT_DXF:
            files = helpers.export_dxf(ctx, os.path.join(HERE, 'out', 'dxf'))
            notes.append('DXF плоских деталей: %d файлов в out/dxf' % len(files))

        ctx.app.activeViewport.fit()
        msg = 'Счётная станция построена.\n\n' + '\n'.join(notes)
        if errors:
            msg += '\n\nНе построены (остальное на месте):\n' + '\n'.join(errors)
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox('Ошибка скрипта:\n' + traceback.format_exc())
