"""End-to-end run of the pipeline against the fake Fusion API (no Fusion needed)."""
import json
import os
import tempfile
import unittest

from tests import fake_fusion

fake_fusion.install()

from lib import ai  # noqa: E402
from lib.config import Settings  # noqa: E402
from lib.log import Log  # noqa: E402
from lib.pipeline import Pipeline  # noqa: E402


class Reporter:
    def __init__(self):
        self.events = []

    def send(self, action, payload=None):
        self.events.append((action, payload or {}))

    def of(self, action):
        return [p for a, p in self.events if a == action]


class FakeFusionPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        design, cls.occs = fake_fusion.build_fake_design()
        cls.app = fake_fusion.Application(design)
        cls.tmp = tempfile.mkdtemp()
        os.environ["HOME"] = cls.tmp          # settings / logs / specs go to a scratch profile

    def _run(self, settings: Settings, mode="render", previous=None, reporter=None):
        reporter = reporter or Reporter()
        log = Log("test")
        p = Pipeline(self.app, settings, log, mode=mode, reporter=reporter, previous=previous)
        p.start()
        return p, reporter

    def test_render_pipeline_end_to_end(self):
        settings = Settings(out_dir=os.path.join(self.tmp, "out"), export_dxf=True)
        p, rep = self._run(settings)
        self.assertTrue(p.done, msg="\n".join(p.log.lines[-15:]))
        errors = [l for l in p.log.lines if "ERROR" in l]
        self.assertEqual(errors, [])
        # model
        parts = [x for x in p.data.parts if x.category != "assembly"]
        self.assertEqual(len(parts), 10)
        left = next(x for x in p.data.parts if x.title == "Боковина")
        self.assertEqual(left.thickness_mm, 16)
        self.assertEqual((left.length_mm, left.width_mm), (720, 400))
        # geometry extraction
        geo = p.scene.parts[left.occ_id]
        self.assertEqual(len(geo.bodies), 1)
        planar = [f for f in geo.bodies[0].faces if f.planar]
        self.assertGreaterEqual(len(planar), 6)
        holes = geo.bodies[0].holes
        self.assertEqual(len(holes), 7)
        through = [h for h in holes if h.through]
        self.assertEqual(len(through), 2)
        blind = [h for h in holes if not h.through]
        self.assertTrue(all(abs(h.depth - 12) < 0.01 or abs(h.depth - 30) < 0.01 for h in blind))
        # sheets went to the palette
        sheets = rep.of("sheets")
        self.assertEqual(len(sheets), 1)
        self.assertEqual(len(sheets[0]["sheets"]), 9)   # СБ, ВЗР, 7 деталей (кронштейн без развёртки — обычный лист)
        updates = rep.of("sheet_update")
        self.assertEqual(len(updates), 9)
        self.assertTrue(all(u["sheets"][0]["svg"].startswith("<svg") for u in updates))
        # export mode reuses the document
        p2, rep2 = self._run(settings, mode="export", previous=p)
        self.assertTrue(p2.done)
        files = rep2.of("done")[0]["files"]
        self.assertTrue(any(f.endswith("_СБ.pdf") for f in files))
        self.assertTrue(any(f.endswith("_1к1.dxf") for f in files))
        self.assertTrue(any(f.endswith("Спецификация.csv") for f in files))
        # AI edit with a fake transport
        def transport(body, headers):
            sheet = json.loads(body["messages"][-1]["content"].split("Текущий лист (JSON):\n", 1)[1].split("\n\nПросьба", 1)[0])
            sheet["views"] = [v for v in sheet["views"] if v["direction"] != "left"]
            sheet["notes"] = [{"text": "Кромка ПВХ по периметру", "position": "auto", "size": "3.5", "bold": False}]
            return {"stop_reason": "end_turn", "model": "fake", "usage": {},
                    "content": [{"type": "text", "text": json.dumps({"explanation": "ок", "sheet": sheet})}]}
        p.settings.ai_api_key = "sk-fake"
        original = ai._http_transport
        ai._http_transport = transport
        try:
            res = p.ai_edit("asm", "убери вид слева и добавь примечание")
        finally:
            ai._http_transport = original
        self.assertEqual(res["explanation"], "ок")
        self.assertEqual(len(res["updated"]), 1)
        svg = p.sheet_payload(res["updated"][0])["svg"]
        self.assertIn("Кромка ПВХ по периметру", svg)
        self.assertEqual([v["direction"] for v in p.document.sheet_spec("asm")["views"]], ["front", "top", "iso"])
        # overrides persisted and applied on a fresh render
        p3, rep3 = self._run(settings)
        self.assertEqual([v["direction"] for v in p3.document.sheet_spec("asm")["views"]], ["front", "top", "iso"])
        idx = p3.reset_sheet("asm")
        self.assertIsNotNone(idx)
        self.assertEqual(len(p3.document.sheet_spec("asm")["views"]), 4)

    def test_spec_mode_writes_report(self):
        settings = Settings(out_dir=os.path.join(self.tmp, "spec_out"))
        p, rep = self._run(settings, mode="spec")
        self.assertTrue(p.done)
        self.assertTrue(any(f.endswith("ОТЧЁТ.txt") for f in os.listdir(settings.out_dir)))


if __name__ == "__main__":
    unittest.main()
