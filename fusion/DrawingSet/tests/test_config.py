import json
import os
import tempfile
import unittest

from lib.config import Settings, load_settings, save_settings


class SettingsTest(unittest.TestCase):
    def test_roundtrip(self):
        s = Settings(explode_factor=4.5, make_details=False, out_dir="/tmp/x")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            save_settings(s, path)
            loaded = load_settings(path)
        self.assertEqual(loaded.explode_factor, 4.5)
        self.assertFalse(loaded.make_details)
        self.assertEqual(loaded.out_dir, "/tmp/x")

    def test_from_dict_ignores_unknown_and_coerces(self):
        s = Settings.from_dict({"explode_factor": "2", "make_explode": 0, "bogus": 1, "out_dir": None})
        self.assertEqual(s.explode_factor, 2.0)
        self.assertFalse(s.make_explode)
        self.assertEqual(s.out_dir, "")

    def test_validate(self):
        s = Settings(make_assembly=False, make_explode=False, make_details=False)
        self.assertTrue(any("модуль" in p for p in s.validate()))
        s = Settings(file_mask="{проект}")
        self.assertTrue(any("{тип}" in p for p in s.validate()))
        self.assertEqual(Settings().validate(), [])

    def test_missing_file_gives_defaults(self):
        s = load_settings("/nonexistent/path.json")
        self.assertTrue(s.out_dir)
        self.assertTrue(s.make_assembly)


if __name__ == "__main__":
    unittest.main()
