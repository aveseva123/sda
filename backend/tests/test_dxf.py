"""Тесты DXF-парсера и нормализации геометрии.

Фикстуры генерируются кодом: реальных файлов заказчика пока нет. Когда они
появятся, эти тесты остаются регрессионными, а на реальных файлах
добавляются отдельные — parser должен разбирать и то и другое.
"""

from __future__ import annotations

import math

import pytest

import tests.factories as factories
from app.dxf import build_shapes, read_file
from app.dxf.layer_meta import LayerMeta, parse_layer_attributes
from app.dxf.normalize import canonical_signature, deduplicate, path_length, stitch
from app.dxf.reader import DxfReadError, _circle_points

# Карта слоёв Базиса по эталонным файлам заказчика.
BAZIS_MAP = {
    "BOARDS": "SHEET",
    "PERIMETER D 18.00": "OUTER",
    "HOLES DIAM 8.00 D 18.00": "DRILL",
    "INSETS D 12.00": "POCKET",
}


def _meta(mapping: dict[str, str]) -> dict[str, LayerMeta]:
    """Метаданные слоёв так, как их построил бы мастер сопоставления."""
    return {
        name: LayerMeta(
            name=name,
            semantic=semantic,
            depth=parse_layer_attributes(name).get("depth"),
            hole_diameter=parse_layer_attributes(name).get("hole_diameter"),
        )
        for name, semantic in mapping.items()
    }


def test_reads_closed_polyline_outline(tmp_path):
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf", width=600, height=400))
    result = build_shapes(scan.primitives, BAZIS_MAP, layer_meta=_meta(BAZIS_MAP))

    assert len(result.shapes) == 1
    shape = result.shapes[0]
    assert shape.length == 600.0
    assert shape.width == 400.0
    assert shape.area == pytest.approx(600 * 400, rel=1e-6)


def test_drill_diameters_come_from_circle_geometry(tmp_path):
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf"))
    shape = build_shapes(scan.primitives, BAZIS_MAP, layer_meta=_meta(BAZIS_MAP)).shapes[0]

    drills = sorted(op.diameter for op in shape.operations if op.semantic == "DRILL")
    assert drills == [8.0, 8.0, 8.0]


def test_sheet_layer_is_not_a_part(tmp_path):
    """Слой BOARDS несёт контур ЛИСТА. Прими его за деталь — и в дереве
    появится «деталь» 2800×2070, а раскрой поедет."""
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf", sheet=(2800.0, 2070.0)))
    result = build_shapes(scan.primitives, BAZIS_MAP, layer_meta=_meta(BAZIS_MAP))

    assert len(result.shapes) == 1
    assert result.shapes[0].length == 600.0
    assert [(s.w, s.h) for s in result.sheets] == [(2800.0, 2070.0)]


def test_depth_and_thickness_come_from_layer_name(tmp_path):
    """Базис пишет глубину обработки в имя слоя — она достовернее правил."""
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf", thickness=18.0, inset_depth=12.0))
    shape = build_shapes(scan.primitives, BAZIS_MAP, layer_meta=_meta(BAZIS_MAP)).shapes[0]

    assert shape.thickness_hint == 18.0, "толщина = глубина контура детали"
    pockets = [op for op in shape.operations if op.semantic == "POCKET"]
    assert pockets and pockets[0].depth == 12.0, "выборка не насквозь"
    drills = [op for op in shape.operations if op.semantic == "DRILL"]
    assert drills and all(op.depth == 18.0 for op in drills), "присадка насквозь"


def test_two_sheets_of_different_thickness_in_one_file(tmp_path):
    """Реальная выгрузка кладёт в один чертёж листы разной толщины."""
    scan = read_file(
        factories.bazis_multi_thickness(
            tmp_path / "m.dxf", first=(18.0, 1000.0, 600.0), second=(4.0, 300.0, 200.0)
        )
    )
    mapping = {
        "BOARDS": "SHEET",
        "PERIMETER D 18.00": "OUTER",
        "PERIMETER D 4.00": "OUTER",
    }
    result = build_shapes(scan.primitives, mapping, layer_meta=_meta(mapping))

    assert sorted(s.thickness for s in result.sheets) == [4.0, 18.0]
    assert sorted(shape.thickness_hint for shape in result.shapes) == [4.0, 18.0]
    # Каждая деталь знает, на каком листе она лежала.
    assert {shape.sheet_index for shape in result.shapes} == {0, 1}


def test_insert_block_is_expanded(tmp_path):
    """Деталь внутри блока должна развернуться в реальную геометрию."""
    scan = read_file(factories.part_in_block(tmp_path / "b.dxf", width=500, height=350))
    shape = build_shapes(scan.primitives, {}).shapes[0]

    assert shape.length == 500.0
    assert shape.width == 350.0


def test_fusion_broken_contour_is_stitched(tmp_path):
    """Fusion отдаёт контур несвязанными сегментами с микроразрывами."""
    scan = read_file(factories.fusion_part(tmp_path / "f.dxf", width=800, height=300, gap=0.005))
    result = build_shapes(scan.primitives, {})

    assert len(result.shapes) == 1
    assert result.shapes[0].length == 800.0
    assert result.shapes[0].width == 300.0


def test_gap_larger_than_tolerance_is_not_stitched():
    """Разрыв больше допуска сшивать нельзя: это настоящая дыра в контуре."""
    segments = [
        [(0, 0), (600, 0)],
        [(600, 5), (600, 400)],
        [(600, 400), (0, 400)],
        [(0, 400), (0, 0)],
    ]
    closed, open_chains = stitch(segments, 0.01)
    assert closed == []
    assert open_chains


def test_duplicate_segments_are_removed():
    chains = [[(0, 0), (10, 0)], [(10, 0), (0, 0)], [(0, 0), (10, 0)]]
    assert len(deduplicate(chains, 0.01, [False] * 3)) == 1


def test_canonical_signature_ignores_start_vertex_and_direction():
    ring_a = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
    ring_b = [(10, 10), (0, 10), (0, 0), (10, 0), (10, 10)]
    assert canonical_signature(ring_a, 0.01, True) == canonical_signature(ring_b, 0.01, True)


def test_inner_contour_becomes_hole(tmp_path):
    """Вложенность определяется по площади и вхождению, а не по слою."""
    scan = read_file(factories.fusion_part(tmp_path / "f.dxf", with_hole=True))
    shape = build_shapes(scan.primitives, {}).shapes[0]

    assert len(shape.inners) == 1
    # Площадь детали — за вычетом выреза 100×100.
    assert shape.area == pytest.approx(800 * 300 - 100 * 100, rel=1e-3)


def test_multiple_outlines_produce_multiple_parts(tmp_path):
    scan = read_file(factories.multi_part_file(tmp_path / "m.dxf"))
    result = build_shapes(scan.primitives, {})

    assert len(result.shapes) == 2
    assert any("несколько деталей" in w for w in result.warnings)


def test_arc_flattening_respects_tolerance(tmp_path):
    """Стрелка прогиба хорды не должна превышать допуск аппроксимации."""
    radius = 50.0
    scan = read_file(factories.fusion_part_with_arc(tmp_path / "a.dxf", radius=radius))
    arc = next(p for p in scan.primitives if p.dxftype == "ARC")

    worst = 0.0
    for (x1, y1), (x2, y2) in zip(arc.points, arc.points[1:], strict=False):
        mid_x, mid_y = (x1 + x2) / 2, (y1 + y2) / 2
        worst = max(worst, radius - math.hypot(mid_x - radius, mid_y - radius))
    assert worst <= 0.05


@pytest.mark.parametrize("radius", [2.5, 4.0, 17.5])
def test_circle_flattening_respects_tolerance(radius):
    points = _circle_points((0.0, 0.0), radius, 0.05)
    pairs = list(zip(points, points[1:] + points[:1], strict=True))
    worst = max(radius - math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in pairs)
    assert worst <= 0.05


def test_spline_is_approximated_not_dropped(tmp_path):
    scan = read_file(factories.fusion_part(tmp_path / "f.dxf"))
    spline = next(p for p in scan.primitives if p.dxftype == "SPLINE")
    assert len(spline.points) > 4, "сплайн должен разложиться в полилинию"


def test_broken_file_raises_readable_error(tmp_path):
    path = tmp_path / "broken.dxf"
    path.write_bytes(b"definitely not a dxf")
    with pytest.raises(DxfReadError):
        read_file(path)


def test_ignored_layers_do_not_affect_geometry(tmp_path):
    """Слой, помеченный IGNORE, не должен влиять на габарит детали."""
    scan = read_file(factories.bazis_part(tmp_path / "p.dxf", width=600, height=400))
    baseline = build_shapes(scan.primitives, BAZIS_MAP, layer_meta=_meta(BAZIS_MAP)).shapes[0]

    mapping = dict(BAZIS_MAP)
    mapping["INSETS D 12.00"] = "IGNORE"
    ignored = build_shapes(scan.primitives, mapping).shapes[0]

    assert baseline.bbox == ignored.bbox
    assert not [op for op in ignored.operations if op.semantic == "POCKET"]


def test_path_length_is_measured_in_mm():
    assert path_length([(0, 0), (3, 4)]) == pytest.approx(5.0)
