# -*- coding: utf-8 -*-
"""Встраивает out/VisionStation.glb в viewer.html и sim.html → out/ (страницы для публикации)."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
glb = base64.b64encode(open(os.path.join(HERE, 'out', 'VisionStation.glb'), 'rb').read()).decode('ascii')
for name in ('viewer.html', 'sim.html'):
    tpl = open(os.path.join(HERE, name), encoding='utf-8').read()
    out = tpl.replace('__GLB_BASE64__', glb)
    dst = os.path.join(HERE, 'out', name)
    open(dst, 'w', encoding='utf-8').write(out)
    print(dst, round(len(out) / 1024), 'КБ')
