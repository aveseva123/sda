# -*- coding: utf-8 -*-
"""Собирает однофайловый скрипт Fusion из модульной папки: python3 fusion/tools/bundle.py fusion/VisionStation VisionStation"""
import os
import re
import sys


def body(path, strip):
    src = open(path, encoding='utf-8').read()
    src = re.sub(r'^# -\*- coding: utf-8 -\*-\n', '', src)
    for pat in strip:
        src = re.sub(pat, '', src, flags=re.M | re.S)
    return src.strip('\n')


def main(folder, entry):
    params = body(os.path.join(folder, 'params.py'), [r'^import math\n'])
    helpers = body(os.path.join(folder, 'helpers.py'), [r'^import (math|os|re|adsk\.core|adsk\.fusion)\n'])
    station = body(os.path.join(folder, 'station.py'), [r'^import math\n', r'^import helpers as H\n', r'^from helpers import \([^)]*\)\n'])
    main_src = open(os.path.join(folder, entry + '.py'), encoding='utf-8').read()
    d0 = main_src.index('"""')
    doc = main_src[d0:main_src.index('"""', d0 + 3) + 3]
    run_src = main_src[main_src.index('def run(context):'):]
    run_src = (run_src.replace('helpers.', '').replace('station.', '')
               .replace('params.P', 'P').replace('params.layout(P)', 'layout(P)').replace('        P = P\n', ''))
    station = station.replace('H.shell(', 'shell(').replace('H.planar_faces_by_z(', 'planar_faces_by_z(')
    out = '\n'.join([
        '# -*- coding: utf-8 -*-',
        doc.replace('"""', '"""Однофайловая сборка. ', 1).replace('Размеры правятся в params.py', 'Размеры — в словаре P ниже'),
        'import math\nimport os\nimport re\nimport traceback\n\nimport adsk.core\nimport adsk.fusion\n',
        'EXPORT_DXF = False          # True — выгрузить эскизы плоских деталей в out/dxf рядом со скриптом',
        'HERE = os.path.dirname(os.path.abspath(__file__))\n\n',
        '# ============================ ПАРАМЕТРЫ ============================', params, '\n',
        '# ============================ ОБЁРТКИ API ============================', helpers, '\n',
        '# ============================ УЗЛЫ ============================', station, '\n',
        '# ============================ ЗАПУСК ============================', run_src,
    ])
    dst = os.path.join(folder, entry + '_single.py')
    open(dst, 'w', encoding='utf-8').write(out)
    print(dst, len(out.splitlines()), 'строк')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
