# -*- coding: utf-8 -*-
"""Сборка визуальной счётной станции в CadQuery (без Fusion): STEP для Fusion, GLB/STL для просмотра, PNG.

Запуск: python3 cad_model.py [выходная папка]. Использует те же params.py и station.py, что скрипт Fusion.
"""
import os
import sys
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cq_helpers                      # noqa: E402
sys.modules['helpers'] = cq_helpers    # station.py импортирует helpers — подставляем CadQuery-версию
import params                          # noqa: E402
import station                         # noqa: E402
import detail                          # noqa: E402
import parts_cq                        # noqa: E402
import modern_cq                       # noqa: E402
import modern2_cq                      # noqa: E402
importlib.reload(station)
importlib.reload(detail)
importlib.reload(parts_cq)
importlib.reload(modern_cq)
importlib.reload(modern2_cq)
import cadquery as cq                  # noqa: E402


def color_for(name):
    """Реалистичные цвета по материалу. Раскраска по категориям (печать/покупное) делается в просмотре переключателем."""
    n = name.lower()
    tests = [
        (lambda: 'световая линия' in n or 'световое кольцо' in n, (0.55, 0.95, 0.85)),
        (lambda: 'маяк' in n, (0.95, 0.35, 0.25)),
        (lambda: 'оболочка корпуса' in n or 'дверца отсека электрики — сегмент' in n or 'сервисная дверца' in n, (0.85, 0.86, 0.84)),
        (lambda: 'пульт наклонный' in n or 'стойка hmi' in n or 'кронштейн hmi' in n or 'хомут стойки' in n or 'ручка сервисной' in n or 'табличка' in n or 'лючок' in n, (0.78, 0.8, 0.82)),
        (lambda: 'пиктограммы' in n, (0.2, 0.2, 0.22)),
        (lambda: 'решётка' in n or 'вентилятор отсека' in n, (0.3, 0.3, 0.32)),
        (lambda: 'воронка — нержав' in n or 'ковш приёмный — нержав' in n, (0.8, 0.81, 0.83)),
        (lambda: 'юбка корпуса' in n or 'пульт-под' in n or 'задняя крышка дисплея' in n, (0.2, 0.21, 0.24)),
        (lambda: 'капот-капсула' in n, (0.94, 0.94, 0.92)),
        (lambda: 'оргстекло' in n and 'тонирован' in n, (0.25, 0.32, 0.4)),
        (lambda: 'консоль дисплея' in n or 'шарнир' in n or 'газлифт' in n, (0.8, 0.81, 0.83)),
        (lambda: 'стяжка' in n, (0.95, 0.95, 0.9)),
        (lambda: 'штырьк' in n or 'наконечник' in n or 'стойка m2.5' in n, (0.85, 0.7, 0.3)),
        (lambda: 'матрица' in n or 'стекло сенсора' in n or 'линза' in n, (0.05, 0.08, 0.14)),
        (lambda: 'оргстекло' in n, (0.75, 0.85, 0.9)),
        (lambda: 'кабель-канал' in n or 'втулка прохода' in n, (0.9, 0.9, 0.88)),
        (lambda: 'зелёный' in n and ('сегмент' in n or 'кнопка пуск' in n or 'лампа' in n), (0.1, 0.7, 0.3)),
        (lambda: 'красный' in n and ('сегмент' in n or 'кнопка стоп' in n), (0.85, 0.1, 0.1)),
        (lambda: 'жёлтый' in n and 'сегмент' in n, (0.95, 0.75, 0.1)),
        (lambda: 'аварийного стопа грибок' in n or 'аварийный стоп — корпус' in n, (0.8, 0.08, 0.08)),
        (lambda: 'кольцо жёлтое' in n, (0.95, 0.8, 0.1)),
        (lambda: 'usb 3.0' in n, (0.15, 0.3, 0.8)),
        (lambda: 'плата' in n or 'hx711 (' in n or 'модуль hx711' in n, (0.12, 0.42, 0.22)),
        (lambda: 'порт' in n or 'разъём' in n or 'гребёнка' in n or 'слот' in n, (0.78, 0.79, 0.8)),
        (lambda: 'клемма' in n or 'фиксатор' in n, (0.55, 0.58, 0.62)),
        (lambda: 'автомат' in n or 'розетка' in n or 'реле' in n or 'адаптер' in n or 'диммер' in n, (0.92, 0.92, 0.9)),
        (lambda: 'рычажок' in n or 'защёлка' in n or 'кнопка тест' in n, (0.2, 0.2, 0.22)),
        (lambda: 'tb6600' in n and 'радиатор' not in n and 'винт' not in n and 'индикатор' not in n, (0.2, 0.35, 0.6)),
        (lambda: 'радиатор' in n or 'рёбра' in n, (0.3, 0.32, 0.36)),
        (lambda: 'кулер' in n or 'крыльчатка' in n or 'лопаст' in n, (0.25, 0.26, 0.3)),
        (lambda: 'ral 7016' in n or 'профиль 20×20' in n or 'профиль алюминиевый 20×20' in n or 'цоколь' in n or 'консоль' in n or 'обрамление' in n, (0.23, 0.24, 0.27)),
        (lambda: 'ral 7035' in n or 'корпус — ' in n or 'дверца отсека' in n or 'дверца обслуживания' in n, (0.84, 0.85, 0.83)),
        (lambda: 'композит' in n or 'дверца капота' in n or 'табличка' in n, (0.95, 0.95, 0.94)),
        (lambda: 'столешница' in n or 'нержав' in n, (0.78, 0.8, 0.82)),
        (lambda: 'колесо' in n and 'полиуретан' in n, (0.35, 0.3, 0.3)),
        (lambda: 'резиновой пятой' in n or 'педаль' in n, (0.12, 0.12, 0.13)),
        (lambda: 'лента пвх' in n, (0.1, 0.42, 0.28)),
        (lambda: 'ремень' in n, (0.1, 0.1, 0.12)),
        (lambda: 'led' in n and 'рассеиватель' in n, (0.98, 0.95, 0.85)),
        (lambda: 'led' in n and 'лента cob' in n, (0.98, 0.85, 0.3)),
        (lambda: 'полоса статуса' in n, (0.3, 0.9, 0.5)),
        (lambda: 'камера' in n or 'объектив' in n or 'дисплей' in n, (0.14, 0.14, 0.16)),
        (lambda: 'шкаф' in n or 'din' in n or 'кабельный ввод' in n or 'петля' in n or 'ручка' in n or 'замок' in n, (0.82, 0.83, 0.8)),
        (lambda: 'подшипник' in n or 'стопорное' in n or 'фланец' in n, (0.72, 0.73, 0.75)),
        (lambda: 'болт' in n or 'винт' in n or 'гайка' in n or 'шайба' in n or 'стойка' in n and 'm12' in n, (0.6, 0.6, 0.62)),
        (lambda: 'nema23' in n or 'шаговый' in n, (0.16, 0.16, 0.18)),
        (lambda: 'серво' in n or 'ds3218' in n, (0.12, 0.14, 0.2)),
        (lambda: 'тензодатчик' in n, (0.8, 0.8, 0.82)),
        (lambda: 'колонна' in n, (0.25, 0.26, 0.28)),
        (lambda: 'алюмин' in n, (0.8, 0.81, 0.83)),
        (lambda: 'сталь' in n or 'профтруба' in n or 'ось' in n or 'опора' in n or 'поперечина' in n or 'ножка' in n or 'пруток' in n, (0.45, 0.46, 0.49)),
        (lambda: name.startswith('[3D]'), (0.2, 0.2, 0.22)),
    ]
    if 'кабель' in n or 'провод' in n or 'шлейф' in n or 'жила' in n:
        for word, rgb in (('жёлто-зелёный', (0.75, 0.8, 0.1)), ('красно-чёрный', (0.75, 0.15, 0.1)), ('красный', (0.8, 0.1, 0.1)),
                          ('синий', (0.15, 0.3, 0.8)), ('коричневый', (0.45, 0.25, 0.1)), ('оранжевый', (0.95, 0.5, 0.1)),
                          ('жёлтый', (0.9, 0.75, 0.2)), ('зелёный', (0.1, 0.6, 0.25)), ('белый', (0.92, 0.92, 0.9)),
                          ('серый', (0.55, 0.55, 0.58)), ('чёрный', (0.08, 0.08, 0.09))):
            if word in n:
                return rgb
        return (0.2, 0.2, 0.2)
    for test, rgb in tests:
        if test():
            return rgb
    return (0.7, 0.7, 0.7)


def build():
    cq_helpers.PARTS.clear()
    P, L = params.P, params.layout(params.P)
    root = cq_helpers.new_component(None, 'Визуальная счётная станция')
    for fn in (station.build_frame, station.build_conveyor, station.build_loading,
               station.build_hood, station.build_outlet,
               detail.build_belt_loop, detail.build_drive_detail, detail.build_servo_and_scale,
               detail.build_front_panel, detail.build_display, detail.build_hood_detail, detail.build_ducts):
        fn(None, root, P, L)
    cam = detail.build_camera(None, root, P, L)
    cab = detail.build_cabinet(None, root, P, L)
    detail.build_cables(None, root, P, L, cam['pi'], cab)
    parts_cq.enrich(P, L)                 # реальные формы, отверстия, крепёж, жилы
    modern_cq.modernize(P, L)             # кожухи, колёса, опоры
    modern2_cq.industrialize(P, L)        # цельная оболочка с радиусами, швы, стойка HMI, наклонный пульт
    subs = {}
    for i, part in enumerate(cq_helpers.PARTS):
        comp = part['comp']
        if comp not in subs:
            subs[comp] = cq.Assembly(name=comp)
        r, g, b = color_for(part['name'])
        subs[comp].add(part['shape'], name='%03d %s' % (i, part['name']), color=cq.Color(r, g, b))
    asm = cq.Assembly(name='VisionStation')
    for comp, sub in subs.items():          # подсборки добавляются уже заполненными, иначе экспорт пустой
        asm.add(sub, name=comp)
    return asm, L


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    asm, L = build()
    asm.export(os.path.join(out_dir, 'VisionStation.step'))
    asm.export(os.path.join(out_dir, 'VisionStation.glb'), tolerance=0.35, angularTolerance=0.22)   # сетка для просмотра: модель грузится отдельными файлами
    comp = cq.Compound.makeCompound([p['shape'] for p in cq_helpers.PARTS])
    cq.exporters.export(comp, os.path.join(out_dir, 'VisionStation.stl'), tolerance=0.5, angularTolerance=0.3)
    bb = comp.BoundingBox()
    print('тел: %d; габарит %.0f × %.0f × %.0f мм' % (len(cq_helpers.PARTS), bb.xlen, bb.ylen, bb.zlen))
    printed = [p['name'] for p in cq_helpers.PARTS if p['name'].startswith('[3D]')]
    print('печатных деталей: %d' % len(printed))
    for p in cq_helpers.PARTS:
        if p['name'].startswith('[3D]'):
            b = p['shape'].BoundingBox(tolerance=0.01)
            print('  %-60s %4.0f × %4.0f × %4.0f  %6.0f см³' % (p['name'][:60], b.xlen, b.ylen, b.zlen, p['shape'].Volume() / 1000))



# --- Кириллица в именах: OCCT пишет имена побайтно как Latin-1. Чиним после экспорта.
import re        # noqa: E402
import json      # noqa: E402
import struct    # noqa: E402


def _unmojibake(s):
    """Снимает один слой «Ð Ð°Ð¼Ð°»: строка, чьи символы — байты UTF-8."""
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def fix_step_names(path):
    """Имена в STEP → стандартная кодировка \\X2\\…\\X0\\ (UTF-16BE); её понимают Fusion, SolidWorks, FreeCAD.

    OCCT пишет кириллицу побайтно (два слоя UTF-8) и переносит строки по 72 символам даже внутри
    строковых литералов, поэтому файл читается как Latin-1, переносы внутри кавычек убираются,
    затем имена декодируются дважды."""
    raw = open(path, 'rb').read().decode('latin-1')

    def enc(m):
        s = m.group(1).replace('\n', '')
        s = _unmojibake(_unmojibake(s))
        if all(ord(ch) < 128 for ch in s):
            return "'" + s + "'"
        out, buf = [], []
        for ch in s:
            if ord(ch) < 128:
                if buf:
                    out.append('\\X2\\' + ''.join(buf) + '\\X0\\')
                    buf = []
                out.append(ch)
            else:
                buf.append('%04X' % ord(ch))
        if buf:
            out.append('\\X2\\' + ''.join(buf) + '\\X0\\')
        return "'" + ''.join(out) + "'"
    txt = re.sub(r"'([^']*)'", enc, raw, flags=re.S)
    open(path, 'w', encoding='ascii').write(txt)


def fix_glb_names(path, names=None):
    """Имена узлов: снять мojibake; узлы вида '169_…_3' (экспорт заменил пробелы и разбил составные тела)
    получают точное имя детали по индексу из списка сборки."""
    d = open(path, 'rb').read()
    jlen = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jlen].decode('utf-8'))
    for key in ('nodes', 'meshes', 'materials', 'scenes'):
        for item in j.get(key, []):
            if 'name' in item:
                nm = _unmojibake(item['name'])
                mm = re.match(r'^(\d{3})[ _]', nm)
                if names and mm and int(mm.group(1)) < len(names):
                    nm = '%s %s' % (mm.group(1), names[int(mm.group(1))])
                item['name'] = nm
    js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    rest = d[20 + jlen:]
    body = struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body)


_main = main


def main(out_dir):          # noqa: F811
    _main(out_dir)
    fix_step_names(os.path.join(out_dir, 'VisionStation.step'))
    fix_glb_names(os.path.join(out_dir, 'VisionStation.glb'), [p['name'] for p in cq_helpers.PARTS])
    json.dump([p['name'] for p in cq_helpers.PARTS], open(os.path.join(out_dir, 'names.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('names.json: %d имён' % len(cq_helpers.PARTS))
    print('имена в STEP и GLB исправлены')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out'))
