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
importlib.reload(station)
import cadquery as cq                  # noqa: E402


def color_for(name):
    n = name.lower()
    if name.startswith('[3D]'):
        return (0.20, 0.72, 0.35)          # печать — зелёный
    if 'покупн' in n or 'подшипник' in n or 'nema' in n:
        return (0.36, 0.47, 0.70)          # покупное — синий
    if 'лента пвх' in n:
        return (0.10, 0.42, 0.28)
    if 'led' in n:
        return (0.98, 0.85, 0.30)
    if 'камера' in n or 'объектив' in n or 'дисплей' in n:
        return (0.15, 0.15, 0.17)
    if 'пвх/акп' in n:
        return (0.28, 0.28, 0.32)
    if 'алюмин' in n:
        return (0.82, 0.83, 0.85)
    if 'сталь' in n or 'профтруба' in n or 'ось' in n or 'опора' in n or 'поперечина' in n or 'ножка' in n:
        return (0.48, 0.49, 0.52)
    return (0.72, 0.72, 0.72)


def build():
    cq_helpers.PARTS.clear()
    P, L = params.P, params.layout(params.P)
    root = cq_helpers.new_component(None, 'Визуальная счётная станция')
    for fn in (station.build_frame, station.build_conveyor, station.build_loading,
               station.build_hood, station.build_outlet, station.build_electronics):
        fn(None, root, P, L)
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
    asm.export(os.path.join(out_dir, 'VisionStation.glb'))
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


def fix_glb_names(path):
    d = open(path, 'rb').read()
    jlen = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jlen].decode('utf-8'))
    for key in ('nodes', 'meshes', 'materials', 'scenes'):
        for item in j.get(key, []):
            if 'name' in item:
                item['name'] = _unmojibake(item['name'])
    js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    rest = d[20 + jlen:]
    body = struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body)


_main = main


def main(out_dir):          # noqa: F811
    _main(out_dir)
    fix_step_names(os.path.join(out_dir, 'VisionStation.step'))
    fix_glb_names(os.path.join(out_dir, 'VisionStation.glb'))
    print('имена в STEP и GLB исправлены')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out'))
