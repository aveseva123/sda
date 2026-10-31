# -*- coding: utf-8 -*-
"""Встраивает out/VisionStation.glb в viewer.html → out/viewer.html (страница для публикации)."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, 'viewer.html'), encoding='utf-8').read()
glb = open(os.path.join(HERE, 'out', 'VisionStation.glb'), 'rb').read()
out = tpl.replace('__GLB_BASE64__', base64.b64encode(glb).decode('ascii'))
dst = os.path.join(HERE, 'out', 'viewer.html')
open(dst, 'w', encoding='utf-8').write(out)
print(dst, round(len(out) / 1024), 'КБ')
