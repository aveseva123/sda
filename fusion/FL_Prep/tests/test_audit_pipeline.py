# -*- coding: utf-8 -*-
"""Сквозной тест шага 1 и отчёта на заглушке adsk (без Fusion)."""
import copy
import math
import os
import shutil
import tempfile
import unittest

import adsk.fusion as F

from FL_Prep import config
from FL_Prep.lib import audit, pipeline, traversal
from FL_Prep.lib.report import Report


def build_design():
    d = F.Design('Бар 37-4 стойка')
    ldsp = F.Material('Egger ЛДСП 16 мм')
    # Тело прямо в корне (ошибка)
    d.rootComponent.add_body(F.make_box('Body1', 50, 30, 1.6, material=ldsp))
    # Две одинаковые полки разными компонентами, одна повёрнута (дубль)
    shelf_a = F.Component('Полка', ldsp)
    shelf_a.add_body(F.make_box('Полка', 80, 30, 1.6, material=ldsp))
    shelf_b = F.Component('Полка средняя', ldsp)
    shelf_b.add_body(F.make_box('Body1', 80, 30, 1.6, rot=(0.3, -0.7, 1.1), offset=(10, 20, 5), material=ldsp))
    d.add_occurrence(shelf_a)
    d.add_occurrence(shelf_a)          # второй экземпляр — не дубль
    d.add_occurrence(shelf_b)
    # Многотельный компонент с дефолтным именем и материалом не из справочника
    multi = F.Component('Component3', F.Material('Steel'))
    multi.add_body(F.make_box('Body1', 10, 10, 1))
    multi.add_body(F.make_box('Body2', 12, 10, 1))
    d.add_occurrence(multi)
    # Подсборка: одинаковые имена у разных компонентов, скрытый компонент
    sub = F.Component('Тумба')
    side = F.Component('Боковина', ldsp)
    side.add_body(F.make_box('Боковина', 70, 45, 1.6, material=ldsp))
    side2 = F.Component('Боковина', ldsp)
    side2.add_body(F.make_box('Боковина', 70, 46, 1.6, material=ldsp))
    d.add_occurrence(side, parent=sub)
    occ_hidden = d.add_occurrence(side2, parent=sub)
    occ_hidden.isLightBulbOn = False
    d.add_occurrence(sub)
    # Пустой компонент без тел, внешняя ссылка не обновлена, незафиксированная позиция
    d.add_occurrence(F.Component('Пустой'))
    d.snapshots.hasPendingSnapshot = True
    d.parentDocument.documentReferences.append(F.DocumentReference('Петля.f3d', True))
    return d


class Traversal(unittest.TestCase):
    def test_unique_components_and_instances(self):
        d = build_design()
        root, records = traversal.collect(d)
        names = [r.name for r in records]
        self.assertEqual(names.count('Полка'), 1)
        shelf = next(r for r in records if r.name == 'Полка')
        self.assertEqual(shelf.instance_count, 2)
        self.assertEqual(len(records), 7)  # Полка, Полка средняя, Component3, Тумба, Боковина, Боковина, Пустой
        side = [r for r in records if r.name == 'Боковина']
        self.assertEqual(len(side), 2)
        self.assertTrue(side[0].path.startswith('Тумба:1+'))
        self.assertEqual(side[0].min_depth, 1)


class Measure(unittest.TestCase):
    def test_fallback_obb_of_rotated_panel(self):
        d = build_design()
        root, records = traversal.collect(d)
        rec = next(r for r in records if r.name == 'Полка средняя')
        m = audit.measure_component(rec, {})
        self.assertEqual(m['source'], 'faces')
        self.assertAlmostEqual(m['dims_mm'][0], 800, places=6)
        self.assertAlmostEqual(m['dims_mm'][1], 300, places=6)
        self.assertAlmostEqual(m['dims_mm'][2], 16, places=6)
        self.assertEqual(m['faces'], 6)


class AuditRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_findings_and_report(self):
        d = build_design()
        st = copy.deepcopy(config.DEFAULT_SETTINGS)
        st['report_folder'] = self.tmp
        report, html_path, csv_path = pipeline.run(d, d.parentDocument, st)
        codes = {f.code for f in report.findings}
        expected = {'A01_root_body', 'A02_multi_body', 'A03_empty_component', 'A05_material_unknown',
                    'A07_default_name', 'A08_default_body_name', 'A09_duplicate_name',
                    'A10_geometric_duplicate', 'A11_hidden_component', 'A13_pending_position',
                    'A14_reference_out_of_date', 'A00_part'}
        self.assertTrue(expected <= codes, expected - codes)
        dup = [f for f in report.findings if f.code == 'A10_geometric_duplicate']
        self.assertEqual(len(dup), 1)
        self.assertIn('Полка средняя', dup[0].details)
        self.assertIn('800×300×16', dup[0].details)
        self.assertEqual(report.project_code, '37-4')
        self.assertTrue(os.path.isfile(html_path) and os.path.isfile(csv_path))
        self.assertTrue(os.path.basename(html_path).startswith('37-4_prep_'))
        # шаги 2–7 отмечены как пропущенные только если включены
        self.assertEqual(report.skipped, [])
        st['steps']['explode'] = True
        report2, _, _ = pipeline.run(d, d.parentDocument, st)
        self.assertEqual(len(report2.skipped), 1)
        # проба API на заглушке: DrawingManager недоступен, OBB через API недоступен
        caps = dict((n, ok) for n, ok, _ in report.capabilities)
        self.assertFalse(caps['adsk.drawing.DrawingManager'])
        self.assertFalse(caps['BRepBody.orientedMinimumBoundingBox'])
        self.assertTrue(caps['NamedViews.add'])
        self.assertEqual(report.summary['Тел в корне'], 1)
        self.assertEqual(report.summary['Групп геометрических дублей'], 1)


if __name__ == '__main__':
    unittest.main()
