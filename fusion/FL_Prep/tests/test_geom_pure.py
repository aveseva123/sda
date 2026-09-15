# -*- coding: utf-8 -*-
import math
import unittest

from FL_Prep.lib import geom_pure as gp
from FL_Prep.lib import units


class ConvexHullRect(unittest.TestCase):
    def test_hull_of_square_with_interior_points(self):
        pts = [(0, 0), (2, 0), (2, 2), (0, 2), (1, 1), (0.5, 1.5)]
        hull = gp.convex_hull(pts)
        self.assertEqual(sorted(hull), [(0.0, 0.0), (0.0, 2.0), (2.0, 0.0), (2.0, 2.0)])

    def test_min_area_rect_rotated(self):
        a = math.radians(33)
        base = [(0, 0), (1200, 0), (1200, 400), (0, 400)]
        pts = [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in base]
        r = gp.min_area_rect(pts)
        self.assertAlmostEqual(r['length'], 1200, places=6)
        self.assertAlmostEqual(r['width'], 400, places=6)
        self.assertAlmostEqual(abs(r['dir_length'][0] * math.cos(a) + r['dir_length'][1] * math.sin(a)), 1.0, places=6)


class Obb(unittest.TestCase):
    def _box(self, lx, ly, lz, rx, ry, rz):
        def rot(v):
            x, y, z = v
            c, s = math.cos(rx), math.sin(rx)
            y, z = y * c - z * s, y * s + z * c
            c, s = math.cos(ry), math.sin(ry)
            x, z = x * c + z * s, -x * s + z * c
            c, s = math.cos(rz), math.sin(rz)
            x, y = x * c - y * s, x * s + y * c
            return (x, y, z)
        pts = [rot((sx * lx, sy * ly, sz * lz)) for sx in (0, 1) for sy in (0, 1) for sz in (0, 1)]
        return pts, rot((0, 0, 1))

    def test_obb_panel_rotated(self):
        pts, normal = self._box(800, 300, 16, 0.3, -0.7, 1.1)
        obb = gp.obb_from_points(pts, normal)
        self.assertAlmostEqual(obb['length'], 800, places=6)
        self.assertAlmostEqual(obb['width'], 300, places=6)
        self.assertAlmostEqual(obb['thickness'], 16, places=6)
        # оси попарно перпендикулярны и единичны
        self.assertAlmostEqual(gp.v_dot(obb['dir_length'], obb['dir_width']), 0, places=9)
        self.assertAlmostEqual(gp.v_dot(obb['dir_length'], obb['dir_thickness']), 0, places=9)
        self.assertAlmostEqual(gp.v_len(obb['dir_length']), 1, places=9)

    def test_aabb_fallback(self):
        box = gp.aabb_from_points([(0, 0, 0), (10, 4, 2)])
        self.assertEqual((box['length'], box['width'], box['thickness']), (10, 4, 2))

    def test_sorted_dims(self):
        self.assertEqual(gp.sorted_dims(16, 800, 300), (800.0, 300.0, 16.0))


class Duplicates(unittest.TestCase):
    def test_grouping_with_tolerance(self):
        s = lambda l, w, t, v, a, f: gp.signature(v, a, f, gp.sorted_dims(l, w, t))
        items = [
            ('A', s(800, 300, 16, 3840, 515.2, 6)),
            ('B', s(800.005, 300, 16, 3840.1, 515.2, 6)),   # в допуске
            ('C', s(800.02, 300, 16, 3840, 515.2, 6)),      # 0.02 > 0.01 мм
            ('D', s(800, 300, 16, 3840, 515.2, 8)),         # другое число граней
            ('E', s(600, 300, 16, 2880, 393.6, 6)),
            ('F', s(600, 300, 16, 2880, 393.6, 6)),
        ]
        groups = gp.group_duplicates(items, tol=0.01, rel_tol=1e-4)
        self.assertEqual(groups, [['A', 'B'], ['E', 'F']])

    def test_no_groups(self):
        items = [('A', gp.signature(1, 1, 6, (1, 1, 1))), ('B', gp.signature(2, 1, 6, (1, 1, 1)))]
        self.assertEqual(gp.group_duplicates(items), [])


class NamesAndCodes(unittest.TestCase):
    def test_default_names(self):
        for name in ('Component1', 'Body3', 'Компонент 2', 'component12 (1)', '', '  '):
            self.assertTrue(gp.is_default_name(name), name)
        for name in ('Полка', 'Боковина левая', 'Body of shelf', 'Component A'):
            self.assertFalse(gp.is_default_name(name), name)

    def test_project_code(self):
        self.assertEqual(gp.parse_project_code('Бар 37-4 стойка v12'), '37-4')
        self.assertEqual(gp.parse_project_code('5-2_shkaf'), '5-2')
        self.assertIsNone(gp.parse_project_code('Shelf v3'))
        self.assertIsNone(gp.parse_project_code('2024-11-05'))

    def test_material_lookup(self):
        ref = [{'name': 'ЛДСП', 'patterns': ['лдсп', 'chipboard']}, {'name': 'Стекло', 'patterns': ['glass']}]
        self.assertEqual(gp.find_material('Egger ЛДСП H1180', ref)['name'], 'ЛДСП')
        self.assertEqual(gp.find_material('Glass, Clear', ref)['name'], 'Стекло')
        self.assertIsNone(gp.find_material('Steel', ref))
        self.assertIsNone(gp.find_material('', ref))

    def test_prefix_and_keywords(self):
        self.assertTrue(gp.has_prefix('_helper', ['_', 'tmp_']))
        self.assertTrue(gp.has_prefix('TMP_box', ['tmp_']))
        self.assertFalse(gp.has_prefix('box', ['_']))
        self.assertTrue(gp.matches_keywords('Фурнитура петля', ['фурнитур']))
        self.assertEqual(gp.strip_occurrence_suffix('Полка:2'), 'Полка')

    def test_units(self):
        self.assertEqual(units.cm_to_mm(1.6), 16.0)
        self.assertEqual(units.mm_to_cm(16), 1.6)
        self.assertEqual(units.fmt_mm(1200.0), '1200')
        self.assertEqual(units.fmt_mm(16.04), '16')
        self.assertEqual(units.fmt_mm(0.8), '0.8')


if __name__ == '__main__':
    unittest.main()
