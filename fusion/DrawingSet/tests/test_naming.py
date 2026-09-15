import unittest

from lib.config import DEFAULT_NAME_REGEX, DEFAULT_CATEGORY_KEYWORDS, DEFAULT_HARDWARE_KEYWORDS
from lib.naming import build_file_name, classify, is_hardware_name, parse_name, sanitize_filename


class ParseNameTest(unittest.TestCase):
    def test_full_pattern(self):
        p = parse_name("37-4_В1_П03_Боковина:1", DEFAULT_NAME_REGEX)
        self.assertTrue(p.matched)
        self.assertEqual(p.project, "37-4")
        self.assertEqual(p.view, "В1")
        self.assertEqual(p.position, "П03")
        self.assertEqual(p.pos_number, "03")
        self.assertEqual(p.title, "Боковина")
        self.assertEqual(p.display_position, "03")

    def test_title_with_underscores(self):
        p = parse_name("37-4_В1_П12_Полка_средняя", DEFAULT_NAME_REGEX)
        self.assertTrue(p.matched)
        self.assertEqual(p.title, "Полка_средняя")

    def test_partial_fallback(self):
        p = parse_name("Стенка_П07", DEFAULT_NAME_REGEX)
        self.assertFalse(p.matched)
        self.assertEqual(p.pos_number, "07")
        self.assertEqual(p.title, "Стенка_П07")

    def test_no_position(self):
        p = parse_name("Component1", DEFAULT_NAME_REGEX)
        self.assertFalse(p.matched)
        self.assertEqual(p.pos_number, "")
        self.assertEqual(p.title, "Component1")

    def test_bad_regex_does_not_raise(self):
        p = parse_name("X_Y", "(unclosed")
        self.assertFalse(p.matched)


class ClassifyTest(unittest.TestCase):
    def test_categories(self):
        kw = DEFAULT_CATEGORY_KEYWORDS
        self.assertEqual(classify("Задняя стенка", kw), "back")
        self.assertEqual(classify("Фасад левый", kw), "facade")
        self.assertEqual(classify("Полка", kw), "shelf")
        self.assertEqual(classify("Боковина", kw), "side")
        self.assertEqual(classify("Крышка", kw), "top")
        self.assertEqual(classify("Дно", kw), "bottom")
        self.assertEqual(classify("Царга", kw), "panel")

    def test_hardware(self):
        self.assertTrue(is_hardware_name("Конфирмат 7x50", DEFAULT_HARDWARE_KEYWORDS))
        self.assertTrue(is_hardware_name("Петля Blum", DEFAULT_HARDWARE_KEYWORDS))
        self.assertFalse(is_hardware_name("Боковина", DEFAULT_HARDWARE_KEYWORDS))


class FileNameTest(unittest.TestCase):
    def test_mask(self):
        name = build_file_name("{проект}_{вид}_{изделие}_{тип}", project="37-4", view="В1",
                               product="Шкаф барный", kind="СБ")
        self.assertEqual(name, "37-4_В1_Шкаф барный_СБ")

    def test_mask_english_and_empty(self):
        name = build_file_name("{project}_{view}_{product}_{type}", project="37-4", view="",
                               product="Шкаф", kind="ДЕТ")
        self.assertEqual(name, "37-4_Шкаф_ДЕТ")

    def test_sanitize(self):
        self.assertEqual(sanitize_filename('a/b:c*d?'), "a-b-c-d-")
        self.assertEqual(sanitize_filename("   "), "untitled")


if __name__ == "__main__":
    unittest.main()
