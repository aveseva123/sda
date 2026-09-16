import unittest

from lib.geom import make_view, pick_scale, scale_label, standard_views
from lib.render import dims
from lib.render.balloons import place_balloons
from lib.render.prims import Circle, Line, Polygon, Text
from lib.render.views import render_parts
from tests.synth import box_part


class ViewTest(unittest.TestCase):
    def test_standard_views_orientation(self):
        v = standard_views((0, 1, 0), (0, 0, -1), True)
        self.assertEqual(v["front"].forward, (0.0, 0.0, 1.0))
        # first angle: plan has the object's front at the top of the paper
        self.assertEqual(v["top"].up, (0.0, 0.0, -1.0))
        v3 = standard_views((0, 1, 0), (0, 0, -1), False)
        self.assertEqual(v3["top"].up, (0.0, 0.0, 1.0))

    def test_painter_hides_back_faces(self):
        # two boxes: a small one behind a large one — only the large front face should remain visible
        big = box_part("big", (0, 0, 0), (100, 100, 10))
        small = box_part("small", (0, 0, 30), (20, 20, 10))   # behind (+z) when viewing from -z
        view = make_view((0, 0, 1), (0, 1, 0))
        img = render_parts([small, big], view)
        polys = [p for p in img.prims if isinstance(p, Polygon)]
        # the last drawn polygon is the big front face (depth = -(-5) = 5 towards viewer at -z)
        self.assertEqual(len(polys[-1].loops[0]), 4)
        self.assertAlmostEqual(abs(polys[-1].loops[0][0][0]), 50.0)
        self.assertIn("big", img.anchors)
        self.assertEqual(img.bbox, (-50.0, -50.0, 50.0, 50.0))

    def test_hole_loops_are_kept(self):
        part = box_part("p", (0, 0, 0), (100, 60, 16), [("+z", 10, 5, 4.0, None)])
        view = make_view((0, 0, -1), (0, 1, 0))
        img = render_parts([part], view)
        front = [p for p in img.prims if isinstance(p, Polygon)][-1]
        self.assertEqual(len(front.loops), 2)   # outer + hole


class DimsTest(unittest.TestCase):
    def test_linear_h_text_value(self):
        prims = dims.linear_h(10, 60, 5, 15, value=500.26)
        texts = [p for p in prims if isinstance(p, Text)]
        self.assertEqual(texts[0].text, "500,3")
        self.assertEqual(texts[0].anchor, "middle")
        self.assertTrue(any(isinstance(p, Line) for p in prims))

    def test_diameter_text(self):
        self.assertEqual(dims.diameter_text(2.5, 12.0, 4, False), "4×⌀5 гл. 12")
        self.assertEqual(dims.diameter_text(4.0, None, 1, True), "⌀8")

    def test_scale_picking(self):
        self.assertEqual(pick_scale(800, 720, 199, 199), 0.2)
        self.assertEqual(scale_label(0.2), "1:5")
        self.assertEqual(scale_label(2.0), "2:1")
        self.assertEqual(pick_scale(50, 30, 200, 200), 4.0)


class BalloonTest(unittest.TestCase):
    def test_balloons_placed_outside_bbox(self):
        anchors = {"a": (10, 10), "b": (90, 10), "c": (50, 90)}
        labels = {"a": "01", "b": "02", "c": "03"}
        prims = place_balloons(anchors, labels, (0, 0, 100, 100), radius=4, margin=14)
        circles = [p for p in prims if isinstance(p, Circle) and p.r == 4]
        self.assertEqual(len(circles), 3)
        for c in circles:
            self.assertTrue(c.cx < 0 or c.cx > 100 or c.cy < 0 or c.cy > 100)
        self.assertEqual(sorted(p.text for p in prims if isinstance(p, Text)), ["01", "02", "03"])


if __name__ == "__main__":
    unittest.main()
