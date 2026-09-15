import unittest

from lib.bom import (BendRow, PartRecord, SPEC_HEADER, bend_rows, description_text, fmt_mm, group_parts,
                     hardware_rows, spec_rows, to_csv)


def part(occ, title, pos="", material="ЛДСП", t=16.0, l=800.0, w=400.0, comp="c1", **kw):
    return PartRecord(occ_id=occ, component_id=comp, raw_name=title, title=title, position=pos,
                      material=material, thickness_mm=t, length_mm=l, width_mm=w, **kw)


class GroupTest(unittest.TestCase):
    def test_merge_by_position(self):
        parts = [part("a", "Боковина", "01"), part("b", "Боковина", "01", comp="c2"),
                 part("c", "Полка", "02", l=600)]
        rows = group_parts(parts)
        self.assertEqual([r.position for r in rows], ["01", "02"])
        self.assertEqual(rows[0].quantity, 2)
        self.assertEqual(rows[0].component_ids, ["c1", "c2"])
        self.assertEqual(rows[1].quantity, 1)

    def test_merge_by_geometry_when_no_position(self):
        parts = [part("a", "Царга"), part("b", "Царга"), part("c", "Царга", w=401.0)]
        rows = group_parts(parts)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].quantity, 2)

    def test_sorting_and_hardware_last(self):
        parts = [part("h", "Конфирмат", "10", is_hardware=True, t=7, l=50, w=7),
                 part("a", "Дно", "3"), part("b", "Боковина", "01")]
        rows = group_parts(parts)
        self.assertEqual([r.title for r in rows], ["Боковина", "Дно", "Конфирмат"])
        self.assertEqual(len(spec_rows(rows)), 2)
        self.assertEqual(hardware_rows(rows), [["10", "Конфирмат", "1", ""]])

    def test_assembly_skipped(self):
        rows = group_parts([part("a", "Подсборка", category="assembly"), part("b", "Полка", "05")])
        self.assertEqual(len(rows), 1)

    def test_spec_row_format(self):
        rows = group_parts([part("a", "Боковина", "01", t=16, l=1200, w=400.26, edge="ПВХ 2 мм",
                                 note="сверловка")])
        self.assertEqual(spec_rows(rows)[0],
                         ["01", "Боковина", "ЛДСП", "16", "1200×400,3", "1", "Кромка: ПВХ 2 мм; сверловка"])


class FormatTest(unittest.TestCase):
    def test_fmt(self):
        self.assertEqual(fmt_mm(16.0), "16")
        self.assertEqual(fmt_mm(0.8), "0,8")
        self.assertEqual(fmt_mm(0.0), "0")

    def test_csv(self):
        text = to_csv(SPEC_HEADER, [["01", "Полка; малая", "ЛДСП", "16", "600×300", "2", ""]])
        lines = text.split("\r\n")
        self.assertEqual(lines[0], ";".join(SPEC_HEADER))
        self.assertIn('"Полка; малая"', lines[1])

    def test_description(self):
        p = part("a", "Боковина", edge="ПВХ 0,4")
        self.assertEqual(description_text(p), "ЛДСП; 16 мм; 800×400; кромка ПВХ 0,4")

    def test_bend_rows(self):
        rows = bend_rows([BendRow("Кронштейн", 1, 90.0, "вверх", 1.5, 0.44, 1.5)])
        self.assertEqual(rows[0], ["Кронштейн", "1", "90", "вверх", "1,5", "0,44", "1,5"])


if __name__ == "__main__":
    unittest.main()
