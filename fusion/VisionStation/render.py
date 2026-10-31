# -*- coding: utf-8 -*-
"""Картинки модели без OpenGL: тесселяция CadQuery → matplotlib. python3 render.py [папка out]"""
import os
import sys

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt                       # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cad_model        # noqa: E402
import cq_helpers       # noqa: E402

VIEWS = {
    'iso': (28, -55),
    'front': (8, -90),
    'side': (8, 0),
    'top': (89, -90),
}


def tessellate(parts, tol=1.0):
    tris, cols = [], []
    for p in parts:
        verts, faces = p['shape'].tessellate(tol, 0.5)
        v = np.array([[q.x, q.y, q.z] for q in verts])
        c = cad_model.color_for(p['name'])
        for f in faces:
            tris.append(v[list(f)])
            cols.append(c)
    return np.array(tris), np.array(cols)


def shade(tris, cols, light=(0.4, -0.6, 0.7)):
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    l = np.array(light) / np.linalg.norm(light)
    k = 0.45 + 0.55 * np.clip(np.abs(n @ l), 0, 1)
    return np.clip(cols * k[:, None], 0, 1)


def render(parts, out_dir):
    tris, cols = tessellate(parts)
    cols = shade(tris, cols)
    lo, hi = tris.min(axis=(0, 1)), tris.max(axis=(0, 1))
    ctr, ext = (lo + hi) / 2, (hi - lo)
    for name, (elev, azim) in VIEWS.items():
        fig = plt.figure(figsize=(14, 9), dpi=110)
        ax = fig.add_subplot(111, projection='3d')
        pc = Poly3DCollection(tris, facecolors=cols, edgecolors='none')
        ax.add_collection3d(pc)
        ax.set_xlim(ctr[0] - ext[0] / 2, ctr[0] + ext[0] / 2)
        ax.set_ylim(ctr[1] - ext[1] / 2, ctr[1] + ext[1] / 2)
        ax.set_zlim(ctr[2] - ext[2] / 2, ctr[2] + ext[2] / 2)
        ax.set_box_aspect(tuple(ext / ext.max()), zoom=1.35 if name == 'iso' else 1.6)
        ax.view_init(elev=elev, azim=azim)
        ax.set_proj_type('ortho' if name != 'iso' else 'persp')
        ax.set_axis_off()
        fig.subplots_adjust(0, 0, 1, 1)
        path = os.path.join(out_dir, 'view_%s.png' % name)
        fig.savefig(path, facecolor='white')
        plt.close(fig)
        print(path)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out')
    cad_model.build()
    render(cq_helpers.PARTS, out)
