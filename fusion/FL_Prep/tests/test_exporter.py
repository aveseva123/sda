# -*- coding: utf-8 -*-
"""Сквозной тест экспорта пакета на заглушке adsk."""
import copy
import json
import os
import shutil
import tempfile
import unittest

import adsk.core as C
import adsk.fusion as F

from FL_Prep import config
from FL_Prep.lib import exporter, pipeline
from FL_Prep.lib.report import Report


def build_design():
    d = F.Design('Стойка 5-2')
    ldsp = F.Material('ЛДСП Egger W980')
    # Панель 80×30×1.6 см, повёрнутая, с двумя сквозными отверстиями Ø0.8 см и одним глухим Ø0.5 см
    shelf = F.Component('Полка', ldsp)
    shelf.partNumber = '5-2-01'
    shelf.description = 'ЛДСП 16 800×300'
    shelf.attributes.add('FL_PREP', 'edge_banding', 'L1')
    body = shelf.add_body(F.make_box('Полка', 80, 30, 1.6, rot=(0.2, 0.4, 0.9), offset=(3, 4, 5), material=ldsp))
    F.add_hole(body, 0, -30, 10, 0.4, through=True)
    F.add_hole(body, 0, 30, 10, 0.4, through=True)
    F.add_hole(body, 1, 0, 0, 0.25, through=False)
    occ1 = d.add_occurrence(shelf)
    occ1.transform2 = C.Matrix3D([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1])
    d.add_occurrence(shelf)
    # Подсборка с фурнитурой, помощник, пустой компонент, скрытое вхождение
    sub = F.Component('Тумба')
    hinge = F.Component('HW_Петля', F.Material('Steel'))
    hinge.add_body(F.make_box('Петля', 5, 3, 1.5))
    d.add_occurrence(hinge, parent=sub)
    side = F.Component('Боковина', ldsp)
    side.add_body(F.make_box('Боковина', 70, 45, 1.6, material=ldsp))
    hidden = d.add_occurrence(side, parent=sub)
    hidden.isLightBulbOn = False
    d.add_occurrence(sub)
    helper = F.Component('_ref')
    helper.add_body(F.make_box('ref', 1, 1, 1))
    d.add_occurrence(helper)
    d.add_occurrence(F.Component('Пустой'))
    # брусок (не панель)
    bar = F.Component('Брусок', F.Material('Массив дуб'))
    bar.add_body(F.make_box('Брусок', 60, 4, 4, material=bar.material))
    d.add_occurrence(bar)
    return d


class ExportPackage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.st = copy.deepcopy(config.DEFAULT_SETTINGS)
        self.st['report_folder'] = self.tmp
        self.st['steps']['audit'] = False

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_package_contents(self):
        d = build_design()
        report = Report('5-2', 'Стойка 5-2')
        pkg = exporter.build_package(d, d.parentDocument, self.st, {}, report, None, '5-2')
        self.assertEqual(pkg['format'], 'fl_prep_export')
        self.assertEqual(pkg['units'], 'mm')
        by_name = dict((c['name'], c) for c in pkg['components'])
        # помощник исключён, остальные есть
        self.assertNotIn('_ref', by_name)
        self.assertEqual(set(by_name), {'Полка', 'Тумба', 'HW_Петля', 'Боковина', 'Пустой', 'Брусок'})
        self.assertEqual(by_name['HW_Петля']['kind'], 'hardware')
        self.assertEqual(by_name['Тумба']['kind'], 'assembly')
        self.assertEqual(by_name['Пустой']['kind'], 'empty')
        self.assertEqual(by_name['Брусок']['kind'], 'part')
        self.assertIsNone(by_name['Брусок']['panel'])           # не панель
        self.assertEqual(by_name['Брусок']['material_ref'], 'Массив')

        shelf = by_name['Полка']
        self.assertEqual(shelf['instances'], 2)
        self.assertEqual(shelf['part_number'], '5-2-01')
        self.assertEqual(shelf['attributes']['FL_PREP']['edge_banding'], 'L1')
        self.assertEqual(shelf['material_ref'], 'ЛДСП')
        self.assertAlmostEqual(shelf['obb']['length'], 800, places=3)
        self.assertAlmostEqual(shelf['obb']['width'], 300, places=3)
        self.assertAlmostEqual(shelf['obb']['thickness'], 16, places=3)
        panel = shelf['panel']
        self.assertIsNotNone(panel)
        outer = panel['outline']['outer']
        self.assertEqual(len(outer), 1)
        self.assertEqual(len(outer[0]), 4)
        self.assertTrue(all(s['type'] == 'line' for s in outer[0]))
        # контур в системе детали: прямоугольник ±400 × ±150
        xs = [p[0] for s in outer[0] for p in s['points']]
        ys = [p[1] for s in outer[0] for p in s['points']]
        self.assertAlmostEqual(max(xs), 400, places=2)
        self.assertAlmostEqual(min(xs), -400, places=2)
        self.assertAlmostEqual(max(ys), 150, places=2)
        # отверстия: два сквозных (после дедупликации) и одно глухое на обратной грани
        dr = panel['drillings']
        self.assertEqual(len(dr), 3)
        through = [x for x in dr if x['through']]
        self.assertEqual(len(through), 2)
        for x in through:
            self.assertAlmostEqual(x['diameter'], 8, places=2)
            self.assertAlmostEqual(abs(x['center'][0]), 300, places=1)
            self.assertAlmostEqual(abs(x['center'][2]), 8, places=1)
        blind = [x for x in dr if not x['through']][0]
        self.assertAlmostEqual(blind['diameter'], 5, places=2)
        self.assertEqual(blind['face'], 'back')
        # ось сверления направлена внутрь: для back-грани вдоль +z детали
        self.assertAlmostEqual(blind['axis'][2], 1.0, places=3)
        # сетка
        self.assertEqual(len(shelf['mesh']['vertices']), 8 * 3)
        self.assertEqual(len(shelf['mesh']['triangles']), 36)
        self.assertEqual(max(shelf['mesh']['triangles']), 7)

        # вхождения: скрытое исключено, помощник исключён, родитель проставлен
        paths = dict((o['path'], o) for o in pkg['occurrences'])
        self.assertIn('Полка:1', paths)
        self.assertIn('Тумба:1+HW_Петля:1', paths)
        self.assertNotIn('Тумба:1+Боковина:1', paths)
        self.assertNotIn('_ref:1', paths)
        self.assertEqual(paths['Тумба:1+HW_Петля:1']['parent'], paths['Тумба:1']['id'])
        self.assertIsNone(paths['Полка:1']['parent'])
        self.assertEqual(paths['Полка:1']['transform'][3], 100.0)   # 10 см → 100 мм
        self.assertEqual(paths['Полка:1']['transform'][11], 300.0)

    def test_include_hidden_and_helpers(self):
        d = build_design()
        self.st['export_include_hidden'] = True
        self.st['export_include_helpers'] = True
        report = Report('5-2')
        pkg = exporter.build_package(d, d.parentDocument, self.st, {}, report, None, '5-2')
        paths = set(o['path'] for o in pkg['occurrences'])
        self.assertIn('Тумба:1+Боковина:1', paths)
        self.assertIn('_ref:1', paths)
        kinds = dict((c['name'], c['kind']) for c in pkg['components'])
        self.assertEqual(kinds['_ref'], 'helper')

    def test_pipeline_writes_json(self):
        d = build_design()
        report, html_path, csv_path = pipeline.run(d, d.parentDocument, self.st)
        self.assertTrue(report.export_path and os.path.isfile(report.export_path))
        self.assertTrue(os.path.basename(report.export_path).startswith('5-2_export_'))
        latest = os.path.join(self.tmp, '5-2_export.json')
        self.assertTrue(os.path.isfile(latest))
        with open(latest, encoding='utf-8') as fh:
            pkg = json.load(fh)
        self.assertEqual(pkg['project_code'], '5-2')
        self.assertEqual(pkg['document']['name'], 'Стойка 5-2')
        codes = {f.code for f in report.findings}
        self.assertIn('E00_export', codes)
        self.assertIn('E02_not_panel', codes)   # Брусок
        self.assertIn('Пакет экспорта', report.summary)


if __name__ == '__main__':
    unittest.main()
