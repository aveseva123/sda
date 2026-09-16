import json
import unittest

from lib import ai, bom, spec
from lib.config import Settings
from tests.sample_cabinet import build


class SpecTest(unittest.TestCase):
    def setUp(self):
        self.data, self.scene = build()
        self.rows = bom.group_parts(self.data.parts)

    def test_default_spec_shape(self):
        sp = spec.default_spec(self.data, self.rows, Settings(), has_flat=set(self.scene.flat_patterns))
        kinds = [sh["kind"] for sh in sp["sheets"]]
        self.assertEqual(kinds.count("СБ"), 1)
        self.assertEqual(kinds.count("ВЗР"), 1)
        self.assertEqual(kinds.count("ДЕТ"), 7)
        asm = sp["sheets"][0]
        self.assertEqual([v["direction"] for v in asm["views"]], ["front", "top", "left", "iso"])
        self.assertEqual(asm["tables"][0]["type"], "spec")
        flat = [sh for sh in sp["sheets"] if sh["subject"].startswith("flat:")]
        self.assertEqual(len(flat), 1)
        json.dumps(sp)  # serialisable

    def test_normalize_tolerates_garbage(self):
        base = spec.sheet("x", "ДЕТ", "t", "part:k", size="A3", orientation="Landscape", first_angle=True, views=[])
        sh = spec.normalize_sheet({"views": [{"direction": "nowhere", "scale": 5, "dims": [{"type": "bogus"}, {"type": "overall_w"}]},
                                             "junk"], "tables": [{"type": "spec", "position": "moon"}], "size": "Z9",
                                   "orientation": "portrait"}, base)
        self.assertEqual(sh["views"][0]["direction"], "front")
        self.assertEqual(sh["views"][0]["scale"], "5")
        self.assertEqual([d["type"] for d in sh["views"][0]["dims"]], ["overall_w"])
        self.assertEqual(sh["tables"][0]["position"], "right")
        self.assertEqual(sh["size"], "A3")
        self.assertEqual(sh["orientation"], "Portrait")

    def test_scale_and_position_parsing(self):
        self.assertEqual(spec.parse_scale("1:5"), 0.2)
        self.assertEqual(spec.parse_scale("2:1"), 2.0)
        self.assertEqual(spec.parse_scale("0,5"), 0.5)
        self.assertIsNone(spec.parse_scale("auto"))
        self.assertEqual(spec.parse_position("120, 40"), (120.0, 40.0))
        self.assertIsNone(spec.parse_position("auto"))

    def test_overrides_merge(self):
        sp = spec.default_spec(self.data, self.rows, Settings())
        ov = {"asm": {"id": "asm", "views": [{"id": "iso", "direction": "iso_left", "balloons": True}]}}
        merged = spec.merge_overrides(sp, ov)
        self.assertEqual(merged["sheets"][0]["views"][0]["direction"], "iso_left")
        self.assertEqual(merged["sheets"][0]["kind"], "СБ")
        self.assertEqual(sp["sheets"][0]["views"][0]["direction"], "front")  # original untouched


class AITest(unittest.TestCase):
    def test_edit_sheet_with_fake_transport(self):
        data, scene = build()
        rows = bom.group_parts(data.parts)
        sp = spec.default_spec(data, rows, Settings())
        sheet = sp["sheets"][0]
        captured = {}

        def transport(body, headers):
            captured["body"] = body
            captured["headers"] = headers
            new = json.loads(json.dumps(sheet))
            new["views"] = [v for v in new["views"] if v["direction"] != "left"]
            new["views"][0]["dims"].append({"type": "linear", "from": "01", "to": "02", "axis": "x", "side": "", "text": ""})
            new["kind"] = "ВЗР"   # must be ignored
            return {"stop_reason": "end_turn", "model": "claude-opus-5", "usage": {"input_tokens": 10},
                    "content": [{"type": "text", "text": json.dumps({"explanation": "Убрал вид слева.", "sheet": new})}]}

        assistant = ai.SheetAssistant("sk-test", transport=transport)
        result = assistant.edit_sheet(sheet, ai.model_summary(data, rows, scene), "убери вид слева")
        self.assertEqual(result.explanation, "Убрал вид слева.")
        self.assertEqual([v["direction"] for v in result.sheet["views"]], ["front", "top", "iso"])
        self.assertEqual(result.sheet["kind"], "СБ")
        self.assertEqual(result.sheet["views"][0]["dims"][-1]["type"], "linear")
        body = captured["body"]
        self.assertEqual(body["model"], "claude-opus-5")
        self.assertEqual(body["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(body["fallbacks"], "default")
        self.assertEqual(captured["headers"]["anthropic-beta"], ai.FALLBACK_BETA)
        self.assertEqual(captured["headers"]["x-api-key"], "sk-test")
        self.assertIn("убери вид слева", body["messages"][-1]["content"])

    def test_refusal_and_missing_key(self):
        data, scene = build()
        rows = bom.group_parts(data.parts)
        sheet = spec.default_spec(data, rows, Settings())["sheets"][0]
        assistant = ai.SheetAssistant("sk-test", transport=lambda b, h: {"stop_reason": "refusal", "stop_details": {"category": "x"}, "content": []})
        res = assistant.edit_sheet(sheet, "m", "q")
        self.assertTrue(res.refused)
        self.assertEqual(res.sheet, sheet)
        with self.assertRaises(ai.AIError):
            ai.SheetAssistant("", transport=lambda b, h: {}).edit_sheet(sheet, "m", "q")

    def test_summary_mentions_parts(self):
        data, scene = build()
        rows = bom.group_parts(data.parts)
        text = ai.model_summary(data, rows, scene)
        self.assertIn("Боковина", text)
        self.assertIn("part:01_Боковина", text)


if __name__ == "__main__":
    unittest.main()
