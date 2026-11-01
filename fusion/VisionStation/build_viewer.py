# -*- coding: utf-8 -*-
"""Собирает страницы просмотра: встраивает three.js, а модель кладёт рядом файлами model.0.txt… (base64 GLB по 8 МБ)."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
VENDOR = [('build/three.min.js', 'three.min.js'), ('examples/js/controls/OrbitControls.js', 'OrbitControls.js'),
          ('examples/js/loaders/GLTFLoader.js', 'GLTFLoader.js')]
ERR = ('<meta charset="utf-8">\n<script>window.addEventListener("error", function (e) { var l = document.getElementById("loading"); '
       'if (l) { l.hidden = false; l.textContent = "Ошибка: " + (e.message || e.type); } });</script>\n')
CHUNK = 8 * 1024 * 1024

glb = base64.b64encode(open(os.path.join(OUT, 'VisionStation.glb'), 'rb').read()).decode('ascii')
for old in [f for f in os.listdir(OUT) if f.startswith('model.') and f.endswith('.txt')]:
    os.remove(os.path.join(OUT, old))
n = 0
while n * CHUNK < len(glb):
    open(os.path.join(OUT, 'model.%d.txt' % n), 'w').write(glb[n * CHUNK:(n + 1) * CHUNK])
    n += 1
print('model: %d файлов, %.1f МБ base64' % (n, len(glb) / 1e6))
for name in ('viewer.html', 'sim.html'):
    tpl = open(os.path.join(HERE, name), encoding='utf-8').read()
    for path, local in VENDOR:
        tag = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/%s"></script>' % path
        assert tag in tpl, tag
        js = open(os.path.join(HERE, 'vendor', local), encoding='utf-8').read()
        assert '</script' not in js
        tpl = tpl.replace(tag, '<script>\n' + js + '\n</script>')
    tpl = ERR + tpl.replace('__MODEL_CHUNKS__', str(n))
    dst = os.path.join(OUT, name)
    open(dst, 'w', encoding='utf-8').write(tpl)
    print(dst, round(len(tpl) / 1024), 'КБ')
