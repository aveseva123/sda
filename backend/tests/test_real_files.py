"""Тесты на реальных DXF заказчика.

Фикстуры в ``tests/fixtures/real`` — это настоящие выгрузки с производства,
а не сгенерированные файлы. Если разбор в них сломается, тест упадёт до
того, как это увидит технолог.

Ожидаемые значения выведены из содержимого файлов: количество деталей,
габариты листов, глубины из имён слоёв.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.dxf import build_shapes, read_file
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.models import ImportFile, Material, Part, PartStatus
from app.resolve import apply_preset, preset_for_source

FIXTURES = Path(__file__).parent / "fixtures" / "real"


def _parse(name: str):
    scan = read_file(FIXTURES / name)
    mapping = apply_preset(scan.layer_names(), preset_for_source(scan.detected_source))
    result = build_shapes(
        scan.primitives, mapping.semantic_by_layer, layer_meta=mapping.meta
    )
    return scan, mapping, result


def test_fixtures_are_present():
    assert sorted(p.name for p in FIXTURES.glob("*.dxf")) == [
        "bazis_12mm_strips.dxf",
        "bazis_16mm_two_sheets.dxf",
        "bazis_18mm_and_4mm.dxf",
        "bazis_18mm_facades.dxf",
        "plain_layer0_18mm.dxf",
    ]


@pytest.mark.parametrize(
    ("filename", "source"),
    [
        ("bazis_12mm_strips.dxf", "bazis"),
        ("bazis_16mm_two_sheets.dxf", "bazis"),
        ("bazis_18mm_and_4mm.dxf", "bazis"),
        ("bazis_18mm_facades.dxf", "bazis"),
    ],
)
def test_bazis_files_are_recognised_and_fully_mapped(filename, source):
    """Все слои получают семантику: ни одного слоя «без карты»."""
    scan, mapping, _ = _parse(filename)
    assert scan.detected_source == source
    assert mapping.unmapped == [], f"без карты остались слои: {mapping.unmapped}"


def test_boards_layer_gives_sheet_sizes_not_parts():
    """Слой BOARDS — это листы. Прими его за детали, и в дереве появятся
    «детали» 2800×2070, а раскрой поедет."""
    _, _, result = _parse("bazis_16mm_two_sheets.dxf")

    assert [(s.w, s.h) for s in result.sheets] == [(2800.0, 2070.0), (2800.0, 2070.0)]
    assert len(result.shapes) == 108
    assert max(shape.length for shape in result.shapes) < 2800.0


def test_one_file_holds_sheets_of_different_thickness():
    """Лист 18 мм и лист 4 мм в одном чертеже — это норма для заказчика."""
    _, _, result = _parse("bazis_18mm_and_4mm.dxf")

    assert [(s.w, s.h, s.thickness) for s in result.sheets] == [
        (2440.0, 1220.0, 18.0),
        (308.0, 308.0, 4.0),
    ]
    assert sorted(shape.thickness_hint for shape in result.shapes) == [4.0, 18.0]
    assert {shape.sheet_index for shape in result.shapes} == {0, 1}


def test_depth_is_read_from_layer_names():
    """Глубина обработки берётся из имени слоя, а не из правил."""
    _, mapping, result = _parse("bazis_16mm_two_sheets.dxf")

    assert mapping.depth_of("PERIMETER D 16.00") == 16.0
    assert mapping.depth_of("PERIMETER D 16.10") == 16.1   # подрез 0.1 мм
    assert mapping.depth_of("INSETS D 12.00") == 12.0
    assert mapping.depth_of("CUTOUTS D 16.00") == 16.0
    assert mapping.meta["HOLES DIAM 4.00 D 16.00"].hole_diameter == 4.0

    pockets = [
        op
        for shape in result.shapes
        for op in shape.operations
        if op.semantic == "POCKET"
    ]
    assert pockets, "выборки должны попасть в операции"
    assert all(op.depth == 12.0 for op in pockets), "выборка не насквозь"


def test_drill_diameter_matches_layer_declaration():
    """В имени слоя объявлен ⌀4 — столько же должно прийти из геометрии."""
    _, _, result = _parse("bazis_16mm_two_sheets.dxf")
    drills = [
        op
        for shape in result.shapes
        for op in shape.operations
        if op.semantic == "DRILL"
    ]
    assert len(drills) == 36
    assert {op.diameter for op in drills} == {4.0}
    assert {op.depth for op in drills} == {16.0}


def test_three_decimal_depth_is_parsed():
    """«PERIMETER D 12.000» — три знака после запятой тоже встречаются."""
    _, mapping, result = _parse("bazis_12mm_strips.dxf")

    assert mapping.depth_of("PERIMETER D 12.000") == 12.0
    assert len(result.shapes) == 8
    assert [(s.w, s.h) for s in result.sheets] == [(760.0, 4000.0)]


def test_facades_with_arcs_are_closed():
    """Фасады со скруглениями: дуги в полилиниях не должны рвать контур."""
    _, _, result = _parse("bazis_18mm_facades.dxf")

    assert len(result.shapes) == 6
    assert not [w for w in result.warnings if "Незакрытых" in w]
    assert all(shape.area > 0 for shape in result.shapes)


def test_source_without_semantics_still_yields_a_part():
    """Всё в слое 0: контур становится деталью, а окружности мебельного
    диаметра — присадкой, а не сквозными вырезами."""
    scan, mapping, result = _parse("plain_layer0_18mm.dxf")

    assert mapping.semantic_by_layer == {"0": "OUTER"}
    assert len(result.shapes) == 1
    shape = result.shapes[0]
    assert (shape.length, shape.width) == (923.0, 621.0)

    drills = [op for op in shape.operations if op.semantic == "DRILL"]
    assert len(drills) == 3, "три чашки петель"
    assert {op.diameter for op in drills} == {35.0}
    assert not shape.inners, "чашка петли — не сквозное отверстие"


def test_real_batch_imports_without_losses(db, tmp_storage):
    """Сквозной импорт всех реальных файлов: ни одна деталь не теряется."""
    db.add_all(
        [
            Material(name="ЛДСП", thickness=t, sheet_w=2800.0, sheet_h=2070.0)
            for t in (4.0, 12.0, 16.0, 18.0)
        ]
    )
    db.flush()

    files = [
        IncomingFile(filename=path.name, relpath=path.name, data=path.read_bytes())
        for path in sorted(FIXTURES.glob("*.dxf"))
    ]
    batch = create_batch(db, name="Реальная пачка", files=files)
    stats = process_batch(db, batch, ImportOptions())

    assert stats["failed"] == 0, stats
    parts = db.scalars(select(Part)).all()

    # 108 + 8 + 2 + 6 + 1 = 125 деталей на листах. Одинаковые схлопываются
    # в позицию с количеством, поэтому позиций меньше, а экземпляров —
    # ровно столько, сколько деталей на листах: ни одна не потеряна.
    assert sum(part.qty for part in parts) == 125
    assert len(parts) == 31, "одинаковые детали свелись в позиции с количеством"

    by_thickness: dict[float | None, int] = {}
    for part in parts:
        by_thickness[part.thickness] = by_thickness.get(part.thickness, 0) + part.qty
    assert by_thickness[16.0] == 108
    assert by_thickness[12.0] == 8
    assert by_thickness[18.0] == 8   # 1 из «18+4», 6 фасадов и 1 без семантики
    assert by_thickness[4.0] == 1

    # Источники разделяются по надёжности: у файлов Базиса толщина взята из
    # глубины контура, у файла без семантики слоёв сработал запасной
    # резолвер по имени файла.
    sources = {part.source_file: part.thickness_source for part in parts}
    assert sources["plain_layer0_18mm.dxf"] == "filename"
    assert {
        source
        for name, source in sources.items()
        if name.startswith("bazis_")
    } == {"layer_depth"}

    assert not [p for p in parts if p.status == PartStatus.NEEDS_CLARIFICATION]


def test_part_without_any_thickness_hint_goes_to_clarification(db, tmp_storage):
    """Тот же файл без подсказки в имени — толщину взять неоткуда.

    Проверяем, что запасной резолвер не выдумывает значение: в слое `0`
    глубины нет, в имени нет, в папке нет.
    """
    db.add(Material(name="ЛДСП", thickness=18.0, sheet_w=2800.0, sheet_h=2070.0))
    db.flush()

    path = FIXTURES / "plain_layer0_18mm.dxf"
    batch = create_batch(
        db,
        name="Без подсказок",
        files=[IncomingFile("dver.dxf", "dver.dxf", path.read_bytes())],
    )
    process_batch(db, batch, ImportOptions())

    part = db.scalar(select(Part))
    assert part.status == PartStatus.NEEDS_CLARIFICATION
    assert part.thickness is None
    assert [a["resolver"] for a in part.clarification["thickness"]["attempts"]] == [
        "layer_depth",
        "layer_map",
        "filename_token",
        "folder_name",
        "dxf_annotation",
    ]


def test_sheet_sizes_from_real_files_are_offered_for_stock(db, tmp_storage):
    """Габариты листов из чертежа предлагаются для заведения на складе."""
    db.add(Material(name="ЛДСП", thickness=16.0, sheet_w=2800.0, sheet_h=2070.0))
    db.flush()

    path = FIXTURES / "bazis_16mm_two_sheets.dxf"
    batch = create_batch(
        db,
        name="Габариты",
        files=[IncomingFile(path.name, path.name, path.read_bytes())],
    )
    process_batch(db, batch, ImportOptions())

    record = db.scalar(select(ImportFile))
    assert [(s["w"], s["h"]) for s in record.detected_sheets] == [
        (2800.0, 2070.0),
        (2800.0, 2070.0),
    ]


def test_geometry_hints_match_the_preset_on_every_real_file():
    """Мастер должен угадывать семантику по одной геометрии.

    Это проверка на будущее: у заказчика есть источники без пресета
    (Fusion, слой ``0``), и там подсказки — единственная опора. Если они
    сходятся с подтверждённым пресетом Базиса на реальных файлах, значит
    эвристика опирается на технологию, а не на знакомые имена слоёв.
    """
    from app.resolve import suggest_semantics

    for path in sorted(FIXTURES.glob("*.dxf")):
        scan = read_file(path)
        hints = {k: str(v) for k, v in suggest_semantics(scan.layers).items()}
        preset = apply_preset(
            scan.layer_names(), preset_for_source(scan.detected_source)
        )
        for layer, semantic in preset.semantic_by_layer.items():
            assert hints.get(layer) == str(semantic), (
                f"{path.name}: слой «{layer}» — подсказка {hints.get(layer)}, "
                f"пресет {semantic}"
            )


def test_pocket_must_lie_inside_a_through_cut():
    """«Глубина меньше максимальной» сама по себе не означает выборку.

    В файле с листами 18 мм и 4 мм контур глубиной 4 мм — это сквозной рез
    на тонком листе, а не выборка на толстом.
    """
    from app.resolve import suggest_semantics

    scan = read_file(FIXTURES / "bazis_18mm_and_4mm.dxf")
    hints = suggest_semantics(scan.layers)

    assert hints["PERIMETER D 4.00"] == "OUTER", "сквозной рез на листе 4 мм"
    assert hints["INSETS D 6.00"] == "POCKET", "выборка внутри детали 18 мм"


def test_wizard_shows_preset_mapping_when_one_exists(db, tmp_storage):
    """Если пресет есть, мастер показывает его карту, а не догадки."""
    from app.importer import layer_summary
    from app.models import Material

    db.add(Material(name="ЛДСП", thickness=16.0, sheet_w=2800.0, sheet_h=2070.0))
    db.flush()

    path = FIXTURES / "bazis_16mm_two_sheets.dxf"
    batch = create_batch(
        db,
        name="Мастер",
        files=[IncomingFile(path.name, path.name, path.read_bytes())],
    )
    summary = layer_summary(db, batch)

    assert summary["preset_name"] == "Базис"
    assert summary["suggestions"]["BOARDS"] == "SHEET"
    assert summary["suggestions"]["PERIMETER D 16.00"] == "OUTER"
    # Глубина из имени слоя видна технологу прямо в таблице мастера.
    depths = {layer["name"]: layer["depth"] for layer in summary["layers"]}
    assert depths["INSETS D 12.00"] == 12.0
    assert depths["BOARDS"] is None
    assert all(layer["from_preset"] for layer in summary["layers"])
