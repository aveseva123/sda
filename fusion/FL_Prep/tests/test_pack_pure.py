# -*- coding: utf-8 -*-
import math
import unittest

from FL_Prep.lib import geom_pure as gp
from FL_Prep.lib import pack_pure as pp


class Frames(unittest.TestCase):
    def test_frame_is_right_handed_and_uses_face_normal(self):
        obb = {'center': (10, 20, 30), 'dir_length': (0.98, 0.1, 0.05), 'dir_width': (0, 1, 0),
               'dir_thickness': (0, 0, 1)}
        fr = pp.part_frame(obb, face_normal=(0, 0, -1))
        self.assertEqual(fr['z'], (0.0, 0.0, -1.0))
        self.assertAlmostEqual(gp.v_dot(fr['x'], fr['z']), 0, places=9)
        self.assertAlmostEqual(gp.v_dot(gp.v_cross(fr['x'], fr['y']), fr['z']), 1, places=9)
        p = pp.from_frame((5, 6, 7), fr)
        self.assertEqual(tuple(round(v, 9) for v in pp.to_frame(p, fr)), (5.0, 6.0, 7.0))

    def test_frame_degenerate_length_dir(self):
        obb = {'center': (0, 0, 0), 'dir_length': (0, 0, 1), 'dir_width': (0, 1, 0), 'dir_thickness': (0, 0, 1)}
        fr = pp.part_frame(obb, face_normal=(0, 0, 1))
        self.assertAlmostEqual(gp.v_len(fr['x']), 1, places=9)
        self.assertAlmostEqual(gp.v_dot(fr['x'], fr['z']), 0, places=9)


class Loops(unittest.TestCase):
    def test_arc_direction(self):
        pts = [(1, 0), (0, 1), (-1, 0)]
        self.assertTrue(pp.arc_is_ccw(pts, (0, 0)))
        self.assertFalse(pp.arc_is_ccw(list(reversed(pts)), (0, 0)))

    def test_loop_as_circle(self):
        seg = {'type': 'circle', 'center': [5, 5], 'radius': 2.5, 'points': [[7.5, 5]]}
        self.assertEqual(pp.loop_as_circle([seg]), ([5, 5], 2.5))
        arcs = [{'type': 'arc', 'center': [0, 0], 'radius': 1, 'points': [[1, 0], [-1, 0]]},
                {'type': 'arc', 'center': [0, 0], 'radius': 1, 'points': [[-1, 0], [1, 0]]}]
        self.assertEqual(pp.loop_as_circle(arcs), ([0, 0], 1))
        arcs[1]['radius'] = 1.5
        self.assertIsNone(pp.loop_as_circle(arcs))
        self.assertIsNone(pp.loop_as_circle([{'type': 'line', 'points': [[0, 0], [1, 1]]}]))

    def test_face_kind(self):
        self.assertEqual(pp.face_kind((0, 0, 1), (0, 0, 1)), 'main')
        self.assertEqual(pp.face_kind((0, 0, -1), (0, 0, 1)), 'back')
        self.assertEqual(pp.face_kind((1, 0, 0), (0, 0, 1)), 'edge')


class Rules(unittest.TestCase):
    def test_is_panel(self):
        self.assertTrue(pp.is_panel((800, 300, 16), 800 * 300))
        self.assertFalse(pp.is_panel((800, 300, 16), 0.2 * 800 * 300))   # главная грань маленькая
        self.assertFalse(pp.is_panel((100, 40, 30), 100 * 40))           # толстый брусок
        self.assertFalse(pp.is_panel((800, 300, 80), 800 * 300))          # толще 60 мм
        self.assertFalse(pp.is_panel(None, 1))

    def test_matrix_cm_to_mm(self):
        m = pp.matrix_cm_to_mm([1, 0, 0, 2.5, 0, 1, 0, -1, 0, 0, 1, 0.25, 0, 0, 0, 1])
        self.assertEqual(m[3], 25.0)
        self.assertEqual(m[7], -10.0)
        self.assertEqual(m[11], 2.5)
        self.assertEqual(m[0], 1.0)

    def test_component_kind(self):
        st = {'helper_prefixes': ['_'], 'hardware_prefixes': ['HW_'], 'hardware_material_keywords': ['фурнитур']}
        self.assertEqual(pp.component_kind('_ref', '', False, 1, st), 'helper')
        self.assertEqual(pp.component_kind('HW_петля', 'Steel', False, 1, st), 'hardware')
        self.assertEqual(pp.component_kind('Петля', 'Фурнитура сталь', False, 1, st), 'hardware')
        self.assertEqual(pp.component_kind('Тумба', '', True, 0, st), 'assembly')
        self.assertEqual(pp.component_kind('Полка', 'ЛДСП', False, 1, st), 'part')
        self.assertEqual(pp.component_kind('X', '', False, 0, st), 'empty')

    def test_parent_path(self):
        self.assertEqual(pp.parent_path('Тумба:1+Полка:2'), 'Тумба:1')
        self.assertIsNone(pp.parent_path('Полка:2'))

    def test_dedupe_through_holes(self):
        d = [{'center': [10, 10, 8], 'diameter': 8, 'face': 'main', 'axis': [0, 0, -1]},
             {'center': [10, 10, -8], 'diameter': 8, 'face': 'back', 'axis': [0, 0, 1]},
             {'center': [50, 10, 8], 'diameter': 5, 'face': 'main', 'axis': [0, 0, -1]},
             {'center': [0, 0, 0], 'diameter': 8, 'face': 'edge', 'axis': [1, 0, 0]}]
        out = pp.dedupe_drillings(d)
        self.assertEqual(len(out), 3)
        self.assertTrue(out[0]['through'])
        self.assertFalse(out[1]['through'])
        self.assertEqual(out[2]['face'], 'edge')


if __name__ == '__main__':
    unittest.main()
