import unittest

from lib.explode import ExplodeItem, ExplodeParams, axis_vector, compute_explode

X, Y, Z = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)


def box(id_, cx, cy, cz, sx, sy, sz, category="panel", parent=None, hw=False, children=None):
    """Axis-aligned panel. Model is Y-up, front is -Z (back panel at +Z)."""
    return ExplodeItem(id=id_, center=(cx, cy, cz), axes=(X, Y, Z), dims=(sx, sy, sz), category=category,
                       parent=parent, is_hardware=hw, children=children or [])


def cabinet():
    # 800 wide (X), 720 high (Y), 400 deep (Z); origin at centre. Panels 16 mm.
    return [
        box("left", -392, 0, 0, 16, 720, 400, "side"),
        box("right", 392, 0, 0, 16, 720, 400, "side"),
        box("top", 0, 352, 0, 768, 16, 400, "top"),
        box("bottom", 0, -352, 0, 768, 16, 400, "bottom"),
        box("shelf", 0, 0, 0, 768, 16, 380, "shelf"),
        box("back", 0, 0, 196, 768, 688, 4, "back"),
        box("door", 0, 0, -208, 796, 716, 18, "facade"),
        box("mid", 0, 0, 0, 16, 688, 380, "side"),      # central partition
        box("screw", 380, 0, 0, 7, 7, 50, "hardware", hw=True),
    ]


class ExplodeTest(unittest.TestCase):
    def setUp(self):
        self.params = ExplodeParams(factor=3.0, step_mm=60.0, stagger=0.0)

    def test_directions(self):
        res = compute_explode(cabinet(), self.params)
        o = res.offsets
        self.assertAlmostEqual(o["left"][0], -60.0)     # away from centre along normal
        self.assertAlmostEqual(o["right"][0], 60.0)
        self.assertAlmostEqual(o["top"][1], 60.0)
        self.assertAlmostEqual(o["bottom"][1], -60.0)
        self.assertAlmostEqual(o["back"][2], 90.0)      # back: 1.5x, +Z is backwards
        self.assertAlmostEqual(o["door"][2], -120.0)    # facade: 2x to the front (-Z)
        self.assertAlmostEqual(o["shelf"][2], -60.0)    # shelf pulled to the front
        self.assertEqual(o["mid"], (0.0, 0.0, 0.0))     # central partition stays
        self.assertEqual(res.front, (0.0, 0.0, -1.0))

    def test_factor_times_thickness(self):
        params = ExplodeParams(factor=10.0, step_mm=10.0, stagger=0.0)
        res = compute_explode(cabinet(), params)
        self.assertAlmostEqual(res.offsets["left"][0], -160.0)   # 10 x 16
        self.assertAlmostEqual(res.offsets["back"][2], 60.0)     # 10 x 4 x 1.5

    def test_hardware_modes(self):
        res = compute_explode(cabinet(), ExplodeParams(hardware_mode="hide", stagger=0.0))
        self.assertIn("screw", res.hidden)
        res = compute_explode(cabinet(), ExplodeParams(hardware_mode="attach", stagger=0.0))
        self.assertEqual(res.offsets["screw"], res.offsets["right"])
        self.assertNotIn("screw", res.hidden)
        res = compute_explode(cabinet(), ExplodeParams(hardware_mode="show", stagger=0.0))
        self.assertEqual(res.offsets["screw"], (0.0, 0.0, 0.0))

    def test_front_fallback_without_back_and_facade(self):
        items = [it for it in cabinet() if it.category not in ("back", "facade")]
        res = compute_explode(items, ExplodeParams(front_fallback=(1.0, 0.0, 0.0), stagger=0.0))
        self.assertEqual(res.front, (1.0, 0.0, 0.0))
        self.assertAlmostEqual(res.offsets["shelf"][0], 60.0)

    def test_stagger_orders_parallel_panels(self):
        items = [box("s1", 0, 100, 0, 700, 16, 380, "shelf"), box("s2", 0, 250, 0, 700, 16, 380, "shelf"),
                 box("l", -350, 0, 0, 16, 700, 400, "side"), box("r", 350, 0, 0, 16, 700, 400, "side"),
                 box("t", 0, 358, 0, 700, 16, 400, "top"), box("b", 0, -358, 0, 700, 16, 400, "bottom")]
        res = compute_explode(items, ExplodeParams(stagger=0.5, front_fallback=(0, 0, -1)))
        self.assertLess(res.offsets["s1"][2], 0)
        self.assertNotEqual(res.offsets["s1"][2], res.offsets["s2"][2])

    def test_subassembly_moves_as_whole(self):
        items = cabinet()
        items.append(box("drawer", 0, -200, -100, 700, 150, 300, "assembly", children=["d_front", "d_bottom"]))
        items.append(box("d_front", 0, -200, -250, 700, 150, 16, "facade", parent="drawer"))
        items.append(box("d_bottom", 0, -270, -100, 680, 12, 280, "bottom", parent="drawer"))
        res = compute_explode(items, ExplodeParams(stagger=0.0, explode_subassemblies=False))
        self.assertNotEqual(res.offsets["drawer"], (0.0, 0.0, 0.0))
        self.assertEqual(res.offsets["d_front"], (0.0, 0.0, 0.0))
        by_id = {it.id: it for it in items}
        self.assertEqual(res.world_offset(by_id, "d_front"), res.offsets["drawer"])

        res2 = compute_explode(items, ExplodeParams(stagger=0.0, explode_subassemblies=True, sub_scale=0.5))
        self.assertNotEqual(res2.offsets["d_front"], (0.0, 0.0, 0.0))
        self.assertLess(abs(res2.offsets["d_front"][2]), abs(res2.offsets["door"][2]))

    def test_axis_vector(self):
        self.assertEqual(axis_vector("-Z"), (0.0, 0.0, -1.0))
        self.assertEqual(axis_vector("y"), (0.0, 1.0, 0.0))
        self.assertEqual(axis_vector("+X"), (1.0, 0.0, 0.0))


if __name__ == "__main__":
    unittest.main()
