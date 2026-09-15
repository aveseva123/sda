# -*- coding: utf-8 -*-
import csv
import datetime
import os
import shutil
import tempfile
import unittest

from FL_Prep.lib.report import Report


class ReportFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_write_html_and_csv(self):
        r = Report('37-4', 'Бар 37-4', dry_run=True)
        r.error(1, 'A01_root_body', 'Тело в корне', entity='Body1', path='Root', token='tok-1')
        r.warning(1, 'A10_geometric_duplicate', 'Дубли <b>', entity='Полка', details='a; b')
        r.info(1, 'A00_part', 'Деталь', fixed=True)
        r.action(2, 'перенесено тело')
        r.skip(6, 'нет API')
        r.instruction('Auto Explode', ['шаг 1', 'шаг 2'])
        r.capability('adsk.drawing.DrawingManager', False, 'скрыто')
        r.summary['Деталей'] = 3
        now = datetime.datetime(2026, 9, 15, 12, 30)
        html_path, csv_path = r.write(self.tmp, now)
        self.assertEqual(os.path.basename(html_path), '37-4_prep_20260915_1230.html')
        with open(html_path, encoding='utf-8') as fh:
            html = fh.read()
        self.assertIn('A01_root_body', html)
        self.assertIn('data-token="tok-1"', html)
        self.assertIn('Дубли &lt;b&gt;', html)          # экранирование
        self.assertIn('Auto Explode', html)
        self.assertIn('DrawingManager', html)
        self.assertIn('перенесено тело', html)
        with open(csv_path, encoding='utf-8-sig') as fh:
            rows = list(csv.reader(fh, delimiter=';'))
        self.assertEqual(rows[0][0], 'Уровень')
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[1][2], 'A01_root_body')
        self.assertEqual(r.count('error'), 1)
        self.assertEqual(len(r.remaining()), 2)

    def test_base_name_sanitized(self):
        r = Report('37/4 ?', '')
        self.assertTrue(r.base_name(datetime.datetime(2026, 1, 1)).startswith('37_4__'))


if __name__ == '__main__':
    unittest.main()
