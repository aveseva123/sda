"""Тесты резолверов толщины, материала, имени файла и карты слоёв."""

from __future__ import annotations

import pytest

import tests.factories as factories
from app.core.colors import PROJECT_PALETTE, next_color_index, product_style, project_color
from app.dxf import read_file
from app.importer.dedup import geometry_signature
from app.resolve import (
    MaterialRef,
    ResolveContext,
    apply_preset,
    parse_filename,
    preset_for_source,
    resolve_material,
    resolve_thickness,
    suggest_semantics,
)

KNOWN = [15.0, 18.0, 30.0]


def resolve(filename: str, **kwargs):
    kwargs.setdefault("known_thicknesses", KNOWN)
    return resolve_thickness(ResolveContext(filename=filename, **kwargs))


# ------------------------------------------------------------------ толщина


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("bok_t18.dxf", 18.0),
        ("bok 30mm.dxf", 30.0),
        ("bok_15_.dxf", 15.0),
        ("Kv12_Shkaf_Bok_18_2.dxf", 18.0),
    ],
)
def test_thickness_from_filename(filename, expected):
    result = resolve(filename)
    assert result.value == expected
    assert result.source == "filename"
    assert result.accepted


def test_thickness_from_folder_when_filename_silent():
    result = resolve("bok.dxf", relpath="Заказ/18mm/bok.dxf")
    assert result.value == 18.0
    assert result.source == "folder"


def test_thickness_from_dxf_annotation_when_name_and_folder_silent():
    result = resolve("bok.dxf", relpath="Заказ/детали/bok.dxf", texts=["Толщина 30"])
    assert result.value == 30.0
    assert result.source == "dxf_annotation"


def test_layer_map_has_highest_priority():
    """Слой перебивает имя файла: карта слоёв — самый достоверный источник."""
    result = resolve(
        "bok_15.dxf",
        layer_names=["ДЕТАЛЬ_18"],
        layer_thickness_regex=r"(?:^|[_\-\s])(?P<value>\d{1,2})(?:$|[_\-\s])",
    )
    assert result.value == 18.0
    assert result.source == "layer_map"


def test_unknown_source_goes_to_clarification_with_trace():
    result = resolve("непонятная-деталь.dxf")
    assert result.value is None
    assert not result.accepted
    assert [a.resolver for a in result.attempts] == [
        "layer_map",
        "filename_token",
        "folder_name",
        "dxf_annotation",
    ]


def test_unknown_thickness_is_not_silently_accepted():
    """19 мм нет в справочнике: значение сохраняется, но требует подтверждения."""
    result = resolve("bok_19.dxf")
    assert result.value == 19.0
    assert result.known is False
    assert result.accepted is False


def test_implausible_number_is_not_taken_for_thickness():
    """Габарит в имени файла не должен уехать в толщину."""
    result = resolve("Polka_1200x600.dxf")
    assert result.value is None


def test_near_miss_snaps_to_known_thickness():
    """16.2 мм из файла — это лист 16 мм, а не новая толщина."""
    result = resolve("bok_16.2_.dxf", known_thicknesses=[16.0])
    assert result.value == 16.0
    assert result.known


# ------------------------------------------------------------------ материал


def _materials() -> list[MaterialRef]:
    return [
        MaterialRef(id=1, name="ЛДСП Белый", thickness=18.0, aliases=["белый", "ldsp"]),
        MaterialRef(id=2, name="ЛДСП Дуб", thickness=18.0, aliases=["дуб"]),
        MaterialRef(id=3, name="Массив", thickness=30.0, aliases=["массив"]),
    ]


def test_material_from_alias_in_filename():
    result = resolve_material(
        filename="Bok_дуб_18.dxf", materials=_materials(), thickness=18.0
    )
    assert result.material_id == 2
    assert result.accepted


def test_single_material_of_thickness_is_taken():
    result = resolve_material(filename="Bok_30.dxf", materials=_materials(), thickness=30.0)
    assert result.material_id == 3
    assert result.accepted


def test_ambiguous_material_requires_clarification():
    """Двум материалам 18 мм соответствует одна толщина — угадывать нельзя."""
    result = resolve_material(filename="Bok_18.dxf", materials=_materials(), thickness=18.0)
    assert result.material_id is None
    assert not result.accepted
    assert "несколько материалов" in result.note


def test_batch_default_material_is_used_as_fallback():
    result = resolve_material(
        filename="Bok_18.dxf",
        materials=_materials(),
        thickness=None,
        batch_default_id=1,
    )
    assert result.material_id == 1
    assert result.source == "batch_default"


# ------------------------------------------------------------- имя файла


def test_filename_template_parsing():
    parsed = parse_filename("Kvartira12_Shkaf-prihozhaya_Bok-levyy_18_2.dxf")
    assert parsed.template == "fusion_full"
    assert parsed.project == "Kvartira12"
    assert parsed.product == "Shkaf prihozhaya"
    assert parsed.part == "Bok levyy"
    assert parsed.thickness == 18.0
    assert parsed.qty == 2


def test_filename_template_mismatch_explains_why():
    parsed = parse_filename("а_б_в_г_д_е_ж.dxf")
    assert not parsed.matched
    assert parsed.tried, "технолог должен видеть, почему шаблон не подошёл"


# ------------------------------------------------------------- карта слоёв


def test_builtin_bazis_preset_maps_layers(tmp_path):
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf"))
    mapping = apply_preset(scan.layer_names(), preset_for_source("bazis"))

    assert mapping.semantic_by_layer["ГАБАРИТ"] == "OUTER"
    assert mapping.semantic_by_layer["ПРИСАДКА"] == "DRILL"
    assert mapping.unmapped == []


def test_suggestions_come_from_geometry_not_layer_names(tmp_path):
    """Подсказки мастера должны работать и там, где имена слоёв бессмысленны."""
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf"))
    suggestions = suggest_semantics(scan.layers)

    assert suggestions["ПРИСАДКА"] == "DRILL"   # только окружности мебельных ⌀
    assert suggestions["ТЕКСТ"] == "INFO"       # только текст
    assert suggestions["ГАБАРИТ"] == "OUTER"    # самый крупный замкнутый контур


def test_unmapped_layer_is_reported():
    mapping = apply_preset(["ГАБАРИТ", "НЕПОНЯТНЫЙ_СЛОЙ"], preset_for_source("bazis"))
    assert mapping.unmapped == ["НЕПОНЯТНЫЙ_СЛОЙ"]


# --------------------------------------------------------------- цвета


def test_project_colors_are_distinct():
    colors = {project_color(i) for i in range(len(PROJECT_PALETTE))}
    assert len(colors) == len(PROJECT_PALETTE)


def test_next_color_index_fills_gaps():
    assert next_color_index([0, 1, 3]) == 2


def test_products_differ_by_pattern_not_only_hue():
    """Различимость не должна опираться только на оттенок."""
    base = project_color(0)
    styles = [product_style(base, i) for i in range(4)]
    assert len({s["pattern"] for s in styles}) == 4
    assert len({s["fill"] for s in styles}) == 4


# ----------------------------------------------------------- дедупликация


def _geom(w: float, h: float, ox: float = 0.0, oy: float = 0.0, ops=None) -> dict:
    return {
        "outer": [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h], [ox, oy]],
        "inners": [],
        "operations": ops or [],
        "bbox": [ox, oy, ox + w, oy + h],
    }


def test_same_part_at_different_origin_is_a_duplicate():
    assert geometry_signature(_geom(600, 400), 18) == geometry_signature(
        _geom(600, 400, 100, 50), 18
    )


def test_different_thickness_is_not_a_duplicate():
    assert geometry_signature(_geom(600, 400), 18) != geometry_signature(_geom(600, 400), 16)


def test_different_drilling_is_not_a_duplicate():
    """Бок левый и бок правый совпадают контуром, но не присадкой."""
    left = _geom(600, 400, ops=[{"semantic": "DRILL", "diameter": 8.0, "center": [32, 50]}])
    right = _geom(600, 400, ops=[{"semantic": "DRILL", "diameter": 8.0, "center": [568, 50]}])
    assert geometry_signature(left, 18) != geometry_signature(right, 18)
