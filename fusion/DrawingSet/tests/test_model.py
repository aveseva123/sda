import unittest

from lib.config import Settings
from lib.model import collect, prepare_sheet_metal, write_component_properties
from tests.fake_adsk import OBB, Body, Component, Face, Geometry, Named, Occurrence, Root


def panel(name, cx, cy, cz, l, w, t, material="ЛДСП Egger W980", holes=0, attrs=None):
    faces = [Face(Geometry("adsk::core::Cylinder", radius=0.25)) for _ in range(holes)]
    comp = Component(name, attrs=attrs)
    return Occurrence(comp, [Body(OBB(cx, cy, cz, l, w, t), material, faces=faces)])


def make_root():
    left = panel("37-4_В1_П01_Боковина", -392, 0, 0, 16, 720, 400)
    right = Occurrence(left.component, [Body(OBB(392, 0, 0, 16, 720, 400), "ЛДСП Egger W980")])
    right.fullPathName = right.name = "37-4_В1_П01_Боковина:2"
    top = panel("37-4_В1_П02_Крышка", 0, 352, 0, 768, 16, 400, holes=4)
    back = panel("37-4_В1_П03_Задняя стенка", 0, 0, 196, 768, 688, 4, material="ХДФ")
    door = panel("37-4_В1_П04_Фасад", 0, 0, -208, 796, 716, 18, material="МДФ",
                 attrs={("DrawingSet", "edge"): "ПВХ 1 мм"})
    screw = panel("Конфирмат 7x50", 380, 300, 0, 50, 7, 7, material="Сталь")
    hidden = panel("37-4_В1_П09_Скрытая", 0, 0, 0, 100, 100, 16)
    hidden.isLightBulbOn = False
    box_bottom = panel("37-4_В1_П05_Дно ящика", 0, -270, -100, 680, 12, 280)
    box_front = panel("37-4_В1_П06_Фасад ящика", 0, -200, -250, 700, 150, 16)
    drawer = Occurrence(Component("37-4_В1_П10_Ящик"), children=[box_bottom, box_front],
                        obb=OBB(0, -200, -100, 700, 150, 300))
    bracket = Occurrence(Component("37-4_В1_П07_Кронштейн"),
                         [Body(OBB(0, 0, 0, 120, 60, 2), "Нержавеющая сталь", is_sheet_metal=True,
                               faces=[Face(Geometry("adsk::core::Plane"), area=50.0)])])
    root = Root("Шкаф барный v3", [left, right, top, back, door, screw, hidden, drawer, bracket])
    root.constructionPlanes = [Named("РАЗРЕЗ А-А"), Named("Plane1")]
    return root


class CollectTest(unittest.TestCase):
    def setUp(self):
        self.settings = Settings()
        self.data = collect(make_root(), self.settings)

    def test_parts_and_positions(self):
        titles = {p.title: p for p in self.data.parts}
        self.assertIn("Боковина", titles)
        self.assertEqual(titles["Боковина"].position, "01")
        self.assertEqual(titles["Боковина"].thickness_mm, 16)
        self.assertEqual(titles["Боковина"].length_mm, 720)
        self.assertEqual(titles["Боковина"].width_mm, 400)
        self.assertEqual(titles["Боковина"].material, "ЛДСП Egger W980")
        self.assertEqual(titles["Боковина"].category, "side")
        self.assertEqual(titles["Задняя стенка"].category, "back")
        self.assertEqual(titles["Фасад"].category, "facade")
        self.assertEqual(titles["Фасад"].edge, "ПВХ 1 мм")
        self.assertEqual(titles["Крышка"].hole_count, 4)
        self.assertNotIn("Скрытая", titles)

    def test_hardware_and_assemblies(self):
        hw = [p for p in self.data.parts if p.is_hardware]
        self.assertEqual([p.title for p in hw], ["Конфирмат 7x50"])
        asm = [p for p in self.data.parts if p.category == "assembly"]
        self.assertEqual([p.title for p in asm], ["Ящик"])
        self.assertTrue(self.data.has_subassemblies)
        children = [p for p in self.data.parts if p.parent_id == "37-4_В1_П10_Ящик:1"]
        self.assertEqual(len(children), 2)
        self.assertEqual(children[0].level, 2)

    def test_explode_items_tree(self):
        items = {it.id: it for it in self.data.explode_items}
        self.assertEqual(items["37-4_В1_П10_Ящик:1"].category, "assembly")
        self.assertEqual(items["37-4_В1_П10_Ящик:1+37-4_В1_П06_Фасад ящика:1"].parent, "37-4_В1_П10_Ящик:1")
        self.assertEqual(sorted(items["37-4_В1_П10_Ящик:1"].children),
                         sorted(["37-4_В1_П10_Ящик:1+37-4_В1_П05_Дно ящика:1",
                                 "37-4_В1_П10_Ящик:1+37-4_В1_П06_Фасад ящика:1"]))
        self.assertTrue(items["Конфирмат 7x50:1"].is_hardware)

    def test_project_view_product_markers(self):
        self.assertEqual(self.data.project, "37-4")
        self.assertEqual(self.data.view, "В1")
        self.assertEqual(self.data.product, "Шкаф барный v3")
        self.assertEqual(self.data.section_markers, ["Шкаф барный v3: РАЗРЕЗ А-А"])

    def test_sheet_metal_detected(self):
        self.assertEqual([sm.title for sm in self.data.sheet_metal], ["Кронштейн"])
        sm_part = next(p for p in self.data.parts if p.title == "Кронштейн")
        self.assertTrue(sm_part.is_sheet_metal)
        self.assertFalse(sm_part.is_hardware)

    def test_write_component_properties(self):
        changed = write_component_properties(self.data)
        self.assertGreater(changed, 0)
        occ = self.data.occurrences["37-4_В1_П04_Фасад:1"]
        self.assertEqual(occ.component.partNumber, "04")
        self.assertEqual(occ.component.description, "МДФ; 18 мм; 796×716; кромка ПВХ 1 мм")

    def test_overrides(self):
        s = Settings(project_override="ZZ", product_override="Изделие")
        d = collect(make_root(), s)
        self.assertEqual(d.project, "ZZ")
        self.assertEqual(d.product, "Изделие")


class SheetMetalTest(unittest.TestCase):
    def test_prepare_creates_flat_pattern_and_bends(self):
        class FP:
            class _Edges(list):
                pass

            def __init__(self):
                self.bendLinesBody = type("B", (), {"edges": ["e1", "e2"]})()

            def getBendInfo(self, edge):
                return (True, edge == "e1", 1.5707963)

        class Rule:
            bendRadius = type("V", (), {"value": 0.15})()
            thickness = type("V", (), {"value": 0.15})()
            kFactor = 0.44

        data = collect(make_root(), Settings())
        comp = data.sheet_metal[0].component
        comp.flatPattern = None
        comp.activeSheetMetalRule = Rule()
        comp.bRepBodies = data.occurrences["37-4_В1_П07_Кронштейн:1"].bRepBodies
        comp.createFlatPattern = lambda face: FP()
        prepare_sheet_metal(data, Settings())
        self.assertIsNotNone(data.sheet_metal[0].flat_pattern)
        self.assertEqual(len(data.bends), 2)
        b = data.bends[0]
        self.assertEqual(b.angle_deg, 90.0)
        self.assertEqual(b.direction, "вверх")
        self.assertAlmostEqual(b.radius_mm, 1.5)
        self.assertEqual(b.part, "07 Кронштейн")


if __name__ == "__main__":
    unittest.main()
