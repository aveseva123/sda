"""Тесты импорта спецификации Базиса и её связывания с DXF."""

from __future__ import annotations

import io

from openpyxl import Workbook
from sqlalchemy import select

import tests.factories as factories
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.importer.spec import index_rows, lookup, parse_csv, parse_spec
from app.models import GrainMode, ImportFile, Part

HEADERS = [
    "Файл",
    "Проект",
    "Изделие",
    "Наименование",
    "Артикул",
    "Количество",
    "Длина",
    "Ширина",
    "Толщина",
    "Материал",
    "Текстура",
    "Кромка верх",
    "Кромка низ",
]
ROW = [
    "Bok-levyy.dxf",
    "Квартира 12",
    "Шкаф прихожая",
    "Бок левый",
    "A-001",
    "2",
    "2000",
    "600",
    "18",
    "ЛДСП Белый",
    "вдоль",
    "ПВХ 2мм",
    "ПВХ 0.4мм",
]


def _csv_bytes(encoding: str = "cp1251") -> bytes:
    lines = [";".join(HEADERS), ";".join(ROW)]
    return "\r\n".join(lines).encode(encoding)


def _xlsx_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(HEADERS)
    sheet.append(ROW)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_csv_in_cp1251_is_parsed():
    """Базис выгружает CSV в кодировке Windows — она должна читаться."""
    result = parse_csv(_csv_bytes("cp1251"))
    assert not result.warnings
    assert len(result.rows) == 1

    fields = result.rows[0].fields
    assert fields["part_name"] == "Бок левый"
    assert fields["qty"] == 2
    assert fields["thickness"] == 18.0
    assert fields["grain"] == GrainMode.ALONG_LENGTH
    assert fields["edge_top"] == "ПВХ 2мм"


def test_xlsx_is_parsed():
    result = parse_spec("spec.xlsx", _xlsx_bytes())
    assert len(result.rows) == 1
    assert result.rows[0].fields["material_name"] == "ЛДСП Белый"


def test_xml_is_parsed():
    xml = (
        '<?xml version="1.0" encoding="utf-8"?><Спецификация>'
        '<Деталь Файл="Bok-levyy.dxf" Наименование="Бок левый" '
        'Толщина="18" Количество="2" Изделие="Шкаф"/></Спецификация>'
    ).encode()
    result = parse_spec("spec.xml", xml)
    assert len(result.rows) == 1
    assert result.rows[0].fields["thickness"] == 18.0


def test_row_is_matched_to_dxf_by_filename():
    result = parse_csv(_csv_bytes())
    index = index_rows(result.rows)
    assert lookup(index, "Bok-levyy.dxf") is not None
    assert lookup(index, "подпапка/Bok-levyy.dxf") is not None
    assert lookup(index, "другая-деталь.dxf") is None


def test_unrecognised_columns_are_reported_not_guessed():
    data = "колонка1;колонка2\r\nзначение1;значение2".encode("cp1251")
    result = parse_csv(data)
    assert result.rows == []
    assert result.warnings, "нераспознанные колонки должны быть видны пользователю"


def test_spec_fills_product_qty_and_edges(db, materials, tmp_storage, tmp_path):
    """Импорт спецификации избавляет от ручного ввода изделий и кромок."""
    dxf = tmp_path / "Bok-levyy.dxf"
    factories.fusion_part(dxf)

    batch = create_batch(
        db,
        name="Базис со спецификацией",
        files=[
            IncomingFile("Bok-levyy.dxf", "Bok-levyy.dxf", dxf.read_bytes()),
            IncomingFile("spec.csv", "spec.csv", _csv_bytes()),
        ],
    )
    stats = process_batch(db, batch, ImportOptions())

    assert stats["parsed"] == 1
    assert stats["spec_rows"] == 1

    part = db.scalar(select(Part))
    assert part.name == "Бок левый"
    assert part.code == "A-001"
    assert part.qty == 2
    assert part.thickness == 18.0
    assert part.thickness_source == "spec"
    assert part.material_source == "spec"
    assert part.length == 2000.0
    assert part.edge_top == "ПВХ 2мм"
    assert part.grain == GrainMode.ALONG_LENGTH

    assert part.order_name == "Квартира 12", "заказ приезжает из спецификации"
    source = db.get(ImportFile, part.source_file_id)
    assert source.order_name == "Квартира 12"


def test_spec_material_missing_from_catalogue_requires_clarification(
    db, materials, tmp_storage, tmp_path
):
    dxf = tmp_path / "Bok-levyy.dxf"
    factories.fusion_part(dxf)
    row = list(ROW)
    row[9] = "МДФ Крашеный"
    spec = ";".join(HEADERS) + "\r\n" + ";".join(row)

    batch = create_batch(
        db,
        name="Неизвестный материал",
        files=[
            IncomingFile("Bok-levyy.dxf", "Bok-levyy.dxf", dxf.read_bytes()),
            IncomingFile("spec.csv", "spec.csv", spec.encode("cp1251")),
        ],
    )
    process_batch(db, batch, ImportOptions())

    part = db.scalar(select(Part))
    assert part.status == "needs_clarification"
    assert "МДФ Крашеный" in part.clarification["material"]["note"]
