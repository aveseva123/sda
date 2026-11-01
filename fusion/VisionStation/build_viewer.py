# -*- coding: utf-8 -*-
"""Встраивает out/VisionStation.glb в viewer.html и sim.html → out/ (страницы для публикации)."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
glb = base64.b64encode(open(os.path.join(HERE, 'out', 'VisionStation.glb'), 'rb').read()).decode('ascii')
# three.js встраивается в страницу: CDN jsDelivr в России часто недоступен
VENDOR = [('build/three.min.js', 'three.min.js'), ('examples/js/controls/OrbitControls.js', 'OrbitControls.js'),
          ('examples/js/loaders/GLTFLoader.js', 'GLTFLoader.js')]
ERR = ('<script>window.addEventListener("error", function (e) { var l = document.getElementById("loading"); '
       'if (l) { l.hidden = false; l.textContent = "Ошибка: " + (e.message || e.type); } });</script>\n')
for name in ('viewer.html', 'sim.html'):
    tpl = open(os.path.join(HERE, name), encoding='utf-8').read()
    for path, local in VENDOR:
        tag = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/%s"></script>' % path
        assert tag in tpl, tag
        js = open(os.path.join(HERE, 'vendor', local), encoding='utf-8').read()
        assert '</script' not in js
        tpl = tpl.replace(tag, '<script>\n' + js + '\n</script>')
    tpl = ERR + tpl
    out = tpl.replace('__GLB_BASE64__', glb)
    dst = os.path.join(HERE, 'out', name)
    open(dst, 'w', encoding='utf-8').write(out)
    print(dst, round(len(out) / 1024), 'КБ')
