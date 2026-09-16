import os
import sys
import tempfile
import unittest

from lib import bom, docbuild
from lib.config import Settings
from lib.explode import ExplodeParams, compute_explode
from lib.render import dxf as dxf_mod
from lib.render.pdf import PdfWriter, find_font
from lib.render.svg import sheet_to_svg
from tests.sample_cabinet import build


class DocBuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.scene = build()
        cls.rows = bom.group_parts(cls.data.parts)
        cls.explode = compute_explode(cls.data.explode_items, ExplodeParams(front_fallback=(0, 0, -1)))

    def test_sheet_set(self):
        s = Settings()
        doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
        kinds = [sh.meta["kind"] for sh in doc.sheets]
        self.assertEqual(kinds.count("СБ"), 1)
        self.assertEqual(kinds.count("ВЗР"), 1)
        # 7 unique non-hardware rows -> 7 detail sheets (bracket as flat pattern)
        self.assertEqual(kinds.count("ДЕТ"), 7)
        self.assertEqual(doc.sheets[0].meta["sheet"], "1 / 9")
        self.assertTrue(all(sh.meta.get("scale") for sh in doc.sheets))
        titles = [sh.meta["title"] for sh in doc.sheets]
        self.assertIn("Поз. 01 Боковина", titles)
        self.assertIn("Поз. 07 Кронштейн — развёртка", titles)

    def test_modules_toggle(self):
        s = Settings(make_assembly=False, make_details=False)
        doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
        self.assertEqual([sh.meta["kind"] for sh in doc.sheets], ["ВЗР"])

    def test_hardware_shown_gets_balloons(self):
        s = Settings(hardware_mode="show", make_assembly=False, make_details=False)
        doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
        svg = sheet_to_svg(doc.sheets[0])
        self.assertIn(">10<", svg)   # hardware position balloon

    def test_svg_pdf_dxf_outputs(self):
        s = Settings()
        doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
        svg = sheet_to_svg(doc.sheets[0])
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("Спецификация", svg)
        w = PdfWriter()
        w.add_sheet(doc.sheets[0])
        pdf = w.build()
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertIn(b"/Type /Page", pdf)
        self.assertIn(b"/FontFile2", pdf)
        text = dxf_mod.sheet_to_dxf(doc.sheets[0])
        self.assertTrue(text.endswith("0\nEOF\n"))
        self.assertIn("ANSI_1251", text)

    @unittest.skipIf(find_font() is None, "no TrueType font available")
    def test_pdf_text_roundtrip(self):
        try:
            sys.modules.setdefault("cryptography", None)
            from pypdf import PdfReader  # type: ignore
        except Exception:
            self.skipTest("pypdf not installed")
        s = Settings()
        doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "t.pdf")
            from lib.render.pdf import write_pdf
            write_pdf(path, doc.sheets[:1])
            text = PdfReader(path).pages[0].extract_text()
        self.assertIn("Боковина", text)
        self.assertIn("Спецификация", text)

    def test_export_document(self):
        with tempfile.TemporaryDirectory() as d:
            s = Settings(out_dir=d, export_dxf=True, export_part_dxf=True, export_svg=True, export_summary_pdf=True)
            doc = docbuild.build_document(self.data, self.scene, s, self.explode, self.rows)
            files = docbuild.export_document(doc, self.data, self.scene, s, self.rows)
            names = [os.path.basename(f) for f in files]
            self.assertIn("37-4_В1_Шкаф барный_СБ.pdf", names)
            self.assertIn("37-4_В1_Шкаф барный_СВОД.pdf", names)
            self.assertTrue(any(n.endswith("_1к1.dxf") for n in names))
            self.assertTrue(any(n.endswith(".svg") for n in names))
            for f in files:
                self.assertGreater(os.path.getsize(f), 100)

    def test_part_dxf_contour(self):
        part = self.scene.parts["37-4_В1_П01_Боковина:left"]
        prims = docbuild.part_dxf_prims(part)
        layers = {p.layer for p in prims}
        self.assertIn("CONTOUR", layers)
        self.assertIn("HOLES", layers)
        xs = [pt[0] for p in prims for pt in getattr(p, "points", [])]
        self.assertAlmostEqual(min(xs), 0.0, places=3)
        self.assertAlmostEqual(max(xs), 720.0, places=3)


if __name__ == "__main__":
    unittest.main()
