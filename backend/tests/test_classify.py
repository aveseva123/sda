"""Тесты распознавания операций по геометрии вектора.

Правило из макета: тип операции берётся из формы контура, слой — только
запасная подсказка и источник глубины.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest
from shapely.geometry import Polygon

from app.dxf import build_shapes, read_file
from app.dxf.classify import (
    circularity,
    classify_circle,
    classify_closed,
    classify_open,
    equivalent_diameter,
)
from app.models import LayerSemantic
from app.resolve import apply_preset, preset_for_source

FIXTURES = Path(__file__).parent / "fixtures" / "real"


def circle(diameter: float, segments: int = 64) -> Polygon:
    r = diameter / 2.0
    return Polygon(
        [
            (r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments))
            for i in range(segments)
        ]
    )


def rect(w: float, h: float) -> Polygon:
    return Polygon([(0, 0), (w, 0), (w, h), (0, h)])


# ------------------------------------------------------- форма контура


def test_circularity_separates_circles_from_rectangles():
    assert circularity(circle(8)) > 0.99
    assert circularity(rect(100, 16)) < 0.5


def test_equivalent_diameter_matches_the_circle():
    assert equivalent_diameter(circle(35)) == pytest.approx(35.0, rel=1e-3)


def test_outermost_closed_contour_is_the_part():
    verdict = classify_closed(
        rect(600, 400), is_outermost=True, layer_depth=None,
        layer_semantic=None, thickness=None,
    )
    assert verdict.semantic == LayerSemantic.OUTER
    assert verdict.from_geometry


@pytest.mark.parametrize("diameter", [3.0, 5.0, 8.0, 15.0, 35.0])
def test_circle_in_furniture_range_is_drilling(diameter):
    verdict = classify_closed(
        circle(diameter), is_outermost=False, layer_depth=None,
        layer_semantic=None, thickness=18.0,
    )
    assert verdict.semantic == LayerSemantic.DRILL


@pytest.mark.parametrize("diameter", [2.0, 40.0, 240.0])
def test_circle_outside_the_range_is_not_drilling(diameter):
    verdict = classify_closed(
        circle(diameter), is_outermost=False, layer_depth=18.0,
        layer_semantic=None, thickness=18.0,
    )
    assert verdict.semantic != LayerSemantic.DRILL


def test_open_polyline_is_a_groove():
    verdict = classify_open(
        [(0, 0), (200, 0)], layer_depth=8.0, layer_semantic=None
    )
    assert verdict is not None
    assert verdict.semantic == LayerSemantic.GROOVE


def test_tiny_open_chain_is_discarded_as_noise():
    assert classify_open([(0, 0), (1, 0)], layer_depth=None, layer_semantic=None) is None


def test_long_open_chain_is_flagged_as_possibly_broken_contour():
    """Незамкнутая линия длиной с деталь — скорее разорванный контур."""
    verdict = classify_open(
        [(0, 0), (1500, 0)], layer_depth=None, layer_semantic=None
    )
    assert verdict is not None
    assert "разорванный" in verdict.reason


# ----------------------------------------------- глубина решает вырез/карман


def test_depth_equal_to_thickness_is_a_through_cutout():
    verdict = classify_closed(
        rect(100, 16), is_outermost=False, layer_depth=16.0,
        layer_semantic=None, thickness=16.0,
    )
    assert verdict.semantic == LayerSemantic.INNER


def test_depth_less_than_thickness_is_a_pocket():
    """Сверху карман и сквозной вырез неразличимы — решает только глубина."""
    verdict = classify_closed(
        rect(100, 16), is_outermost=False, layer_depth=12.0,
        layer_semantic=None, thickness=16.0,
    )
    assert verdict.semantic == LayerSemantic.POCKET
    assert not verdict.from_geometry, "решение принято не по геометрии — это честно видно"


def test_large_circle_respects_depth_too():
    """Круглая выборка ⌀270 на 6 мм — не сквозное окно."""
    pocket = classify_circle(270.0, layer_depth=6.0, thickness=18.0)
    through = classify_circle(270.0, layer_depth=18.0, thickness=18.0)
    assert pocket.semantic == LayerSemantic.POCKET
    assert through.semantic == LayerSemantic.INNER


def test_without_depth_layer_hint_is_used_as_fallback():
    verdict = classify_closed(
        rect(100, 16), is_outermost=False, layer_depth=None,
        layer_semantic=LayerSemantic.POCKET, thickness=16.0,
    )
    assert verdict.semantic == LayerSemantic.POCKET
    assert not verdict.from_geometry


# ------------------------------------------------- на реальных файлах


def _parse(name: str):
    scan = read_file(FIXTURES / name)
    mapping = apply_preset(scan.layer_names(), preset_for_source(scan.detected_source))
    return build_shapes(
        scan.primitives, mapping.semantic_by_layer, layer_meta=mapping.meta
    )


def test_real_file_operations_are_recognised_by_geometry():
    result = _parse("bazis_16mm_two_sheets.dxf")

    assert result.detected["OUTER"] == 108
    assert result.detected["DRILL"] == 36      # ⌀4 — присадка
    assert result.detected["POCKET"] == 84     # глубина 12 на листе 16
    assert result.detected["INNER"] == 24      # глубина 16 — насквозь


def test_hole_inside_a_pocket_stays_a_hole_not_a_new_part():
    """Карман не вскрывает материал, значит отверстие в нём — не деталь.

    В реальном файле круглая выборка ⌀270 на 6 мм, а внутри неё сквозное
    ⌀240. Правило «чётная глубина вложенности = деталь» делало из ⌀240
    третью деталь на листе.
    """
    result = _parse("bazis_18mm_and_4mm.dxf")

    assert len(result.shapes) == 2, "деталей должно быть ровно две"
    assert result.detected["POCKET"] == 1
    assert result.detected["INNER"] == 1
    assert sum(len(shape.inners) for shape in result.shapes) == 1


def test_large_round_hole_is_not_mistaken_for_drilling():
    """Слой называется HOLES, но ⌀240 — это круглое окно, а не присадка."""
    result = _parse("bazis_18mm_and_4mm.dxf")
    drills = [
        op
        for shape in result.shapes
        for op in shape.operations
        if op.semantic == LayerSemantic.DRILL
    ]
    assert drills == [], "имя слоя не должно перебивать геометрию"


def test_source_without_layer_semantics_still_recognised():
    """Всё в слое 0: контур стал деталью, три ⌀35 — присадкой."""
    result = _parse("plain_layer0_18mm.dxf")

    assert result.detected["OUTER"] == 1
    assert result.detected["DRILL"] == 3
    assert not result.shapes[0].inners, "чашка петли — не сквозное отверстие"
