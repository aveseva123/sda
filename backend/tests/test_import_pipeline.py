"""Сквозные тесты конвейера импорта.

Проверяют главный сценарий приёмки: «загрузил пачку DXF вперемешку — система
разложила их по толщинам, ни одна деталь не потеряна и не получила чужую
толщину».
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

import tests.factories as factories
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.models import ImportFile, Part, PartInstance, PartStatus


def _dxf_bytes(tmp_path: Path, maker, name: str, **kwargs) -> bytes:
    path = tmp_path / name
    maker(path, **kwargs)
    return path.read_bytes()


def _incoming(name: str, data: bytes, relpath: str | None = None) -> IncomingFile:
    return IncomingFile(filename=name, relpath=relpath or name, data=data)


@pytest.fixture
def bazis_files(tmp_path) -> list[IncomingFile]:
    """Три толщины вперемешку, по образцу реальной пачки из Базиса.

    Толщина сидит в имени слоя (``PERIMETER D 18.00``), как в эталонных
    файлах заказчика, — имена файлов на неё не влияют.
    """
    files = []
    for thickness, size in ((18, (600, 400)), (15, (800, 300)), (30, (1200, 500))):
        data = _dxf_bytes(
            tmp_path,
            factories.bazis_part,
            f"src_{thickness}.dxf",
            width=size[0],
            height=size[1],
            thickness=float(thickness),
        )
        files.append(_incoming(f"Detal-{thickness}.dxf", data))
    return files


def test_sorts_parts_by_thickness(db, materials, tmp_storage, bazis_files):
    batch = create_batch(db, name="Пачка вперемешку", files=bazis_files)
    process_batch(db, batch, ImportOptions())

    parts = db.scalars(select(Part)).all()
    assert len(parts) == 3, "ни одна деталь не должна потеряться"
    assert sorted(p.thickness for p in parts) == [15.0, 18.0, 30.0]
    assert all(p.thickness_source == "layer_depth" for p in parts)
    assert all(p.status == PartStatus.READY for p in parts), [
        (p.name, p.clarification) for p in parts
    ]


def test_material_follows_thickness(db, materials, tmp_storage, bazis_files):
    batch = create_batch(db, name="Материалы", files=bazis_files)
    process_batch(db, batch, ImportOptions())

    by_thickness = {p.thickness: p for p in db.scalars(select(Part)).all()}
    materials_by_id = {m.id: m for m in materials}
    assert materials_by_id[by_thickness[18.0].material_id].name == "ЛДСП Белый"
    assert materials_by_id[by_thickness[15.0].material_id].name == "ЛДСП Дуб"
    assert materials_by_id[by_thickness[30.0].material_id].name == "Массив"


def test_unresolved_thickness_goes_to_clarification_queue(db, materials, tmp_storage, tmp_path):
    """Толщину неоткуда взять — деталь обязана попасть в очередь уточнений,
    а не получить угаданное значение."""
    data = _dxf_bytes(tmp_path, factories.fusion_part, "plain.dxf")
    batch = create_batch(db, name="Без толщины", files=[_incoming("deталь.dxf", data)])
    process_batch(db, batch, ImportOptions())

    part = db.scalar(select(Part))
    assert part is not None, "деталь не должна пропасть"
    assert part.status == PartStatus.NEEDS_CLARIFICATION
    assert part.thickness is None
    assert part.clarification["thickness"]["attempts"], "должна быть трассировка попыток"


def test_thickness_from_folder_name(db, materials, tmp_storage, tmp_path):
    data = _dxf_bytes(tmp_path, factories.fusion_part, "plain.dxf")
    batch = create_batch(
        db, name="По папкам", files=[_incoming("bok.dxf", data, relpath="18mm/bok.dxf")]
    )
    process_batch(db, batch, ImportOptions())

    part = db.scalar(select(Part))
    assert part.thickness == 18.0
    assert part.thickness_source == "folder"
    assert part.status == PartStatus.READY


def test_filename_template_gives_order_and_part_name(db, materials, tmp_storage, tmp_path):
    """Источник без метаданных в DXF: заказ и имя детали едут в имени файла."""
    data = _dxf_bytes(tmp_path, factories.fusion_part, "plain.dxf")
    files = [
        _incoming("Kvartira12_Shkaf-prihozhaya_Bok-levyy_18_2.dxf", data),
    ]
    batch = create_batch(db, name="Из имени файла", files=files)
    process_batch(db, batch, ImportOptions())

    part = db.scalar(select(Part))
    assert part.order_name == "Kvartira12", "заказ — просто имя, без клиентов и сроков"
    assert part.name == "Bok levyy"
    assert part.qty == 2

    source = db.get(ImportFile, part.source_file_id)
    assert source.order_name == "Kvartira12"
    assert source.color.startswith("#"), "цвет закреплён за файлом"

    instances = db.scalar(select(func.count()).select_from(PartInstance))
    assert instances == 2, "на каждый экземпляр нужен свой стикер"


def test_each_file_gets_its_own_colour(db, materials, tmp_storage, tmp_path):
    """В раскрое рядом лежат детали из разных DXF — их различает цвет файла."""
    first = _dxf_bytes(tmp_path, factories.fusion_part, "a.dxf", width=800, height=300)
    second = _dxf_bytes(tmp_path, factories.fusion_part, "b.dxf", width=500, height=250)
    batch = create_batch(
        db,
        name="Два файла",
        files=[
            _incoming("Zakaz_Gruppa_Bok_18_1.dxf", first),
            _incoming("Zakaz_Gruppa_Polka_18_1.dxf", second),
        ],
    )
    process_batch(db, batch, ImportOptions())

    colours = {f.color for f in db.scalars(select(ImportFile)).all()}
    assert len(colours) == 2, "разным файлам — разные цвета"


def test_identical_parts_inside_one_file_are_deduplicated(db, materials, tmp_storage, tmp_path):
    """Один разложенный лист содержит одну и ту же полку двадцать раз.

    Дедупликация идёт В ПРЕДЕЛАХ ФАЙЛА: схлопнуть детали из разных DXF
    нельзя — потеряется, из какого файла деталь приехала, а именно по этому
    её и опознают в цеху.
    """
    path = tmp_path / "polki.dxf"
    factories.repeated_parts(path, count=3, width=600, height=300, thickness=18.0)
    batch = create_batch(
        db,
        name="Дубли в одном файле",
        files=[_incoming("Kv12_Shkaf_Polka_18_1.dxf", path.read_bytes())],
    )
    process_batch(db, batch, ImportOptions())

    parts = db.scalars(select(Part)).all()
    assert len(parts) == 1, "одинаковые детали схлопываются в позицию с количеством"
    assert parts[0].qty == 3
    assert db.scalar(select(func.count()).select_from(PartInstance)) == 3


def test_identical_parts_in_different_files_stay_separate(db, materials, tmp_storage, tmp_path):
    """Одинаковые детали из разных файлов не схлопываются: у них разный цвет
    и разное происхождение, и в цеху их различают именно по файлу."""
    data = _dxf_bytes(tmp_path, factories.fusion_part, "polka.dxf")
    batch = create_batch(
        db,
        name="Дубли в разных файлах",
        files=[
            _incoming("Kv12_Shkaf_Polka_18_1.dxf", data),
            _incoming("Kv12_Shkaf_Polka-2_18_1.dxf", data),
        ],
    )
    process_batch(db, batch, ImportOptions())

    parts = db.scalars(select(Part)).all()
    assert len(parts) == 2
    assert {p.source_file_id for p in parts} == {
        f.id for f in db.scalars(select(ImportFile)).all()
    }


def test_zip_upload_is_unpacked(db, materials, tmp_storage, tmp_path):
    """ZIP с папками: толщина берётся из имени папки.

    Источник намеренно взят без глубины в слоях — иначе выиграл бы он,
    и резолвер по папке остался бы непроверенным.
    """
    import io
    import zipfile

    data = _dxf_bytes(tmp_path, factories.fusion_part, "inzip.dxf")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("18mm/Bok.dxf", data)
        archive.writestr("15mm/Polka.dxf", data)
        archive.writestr("__MACOSX/._junk", b"junk")

    batch = create_batch(
        db, name="Архив", files=[_incoming("pack.zip", buffer.getvalue())]
    )
    process_batch(db, batch, ImportOptions())

    records = db.scalars(select(ImportFile)).all()
    assert len(records) == 2, "служебные файлы архива не должны попадать в импорт"
    parts = db.scalars(select(Part)).all()
    assert {p.thickness for p in parts} == {18.0, 15.0}
    assert all(p.thickness_source == "folder" for p in parts)


def test_mixed_sources_in_one_batch(db, materials, tmp_storage, tmp_path):
    """В одной пачке едут выгрузки из Базиса и из Fusion.

    Источник и карта слоёв определяются для каждого файла отдельно: если
    выбирать пресет на всю загрузку, половина деталей уезжает в очередь
    уточнений без причины.
    """
    files = []
    for index, thickness in enumerate((18, 15, 30)):
        bazis = _dxf_bytes(
            tmp_path,
            factories.bazis_part,
            f"bazis_{thickness}.dxf",
            width=600 + index * 50,
            height=400,
            thickness=float(thickness),
        )
        fusion = _dxf_bytes(
            tmp_path,
            factories.fusion_part,
            f"fusion_{thickness}.dxf",
            width=700 + index * 50,
            height=350,
        )
        files.append(_incoming(f"Kv12_Shkaf_Bazis-{index}_{thickness}_1.dxf", bazis))
        files.append(_incoming(f"Kv12_Shkaf_Fusion-{index}_{thickness}_1.dxf", fusion))

    batch = create_batch(db, name="Смешанная пачка", files=files)
    stats = process_batch(db, batch, ImportOptions())

    assert stats["failed"] == 0
    assert stats["needs_clarification"] == 0, "смешанный источник не повод для уточнений"
    parts = db.scalars(select(Part)).all()
    assert len(parts) == 6
    assert sorted(p.thickness for p in parts) == [15.0, 15.0, 18.0, 18.0, 30.0, 30.0]


def test_no_part_is_lost_on_broken_file(db, materials, tmp_storage, tmp_path):
    """Битый файл помечается ошибкой, но не роняет всю загрузку."""
    good = _dxf_bytes(tmp_path, factories.bazis_part, "good.dxf")
    files = [
        _incoming("Kv_Shkaf_Good_18_1.dxf", good),
        _incoming("Kv_Shkaf_Broken_18_1.dxf", b"not a dxf at all"),
    ]
    batch = create_batch(db, name="С битым файлом", files=files)
    stats = process_batch(db, batch, ImportOptions())

    assert stats["parsed"] == 1
    assert stats["failed"] == 1
    broken = db.scalar(
        select(ImportFile).where(ImportFile.filename == "Kv_Shkaf_Broken_18_1.dxf")
    )
    assert broken.error, "причина отказа должна быть видна технологу"


def test_same_shape_different_material_is_not_deduplicated(db, materials, tmp_storage, tmp_path):
    """Одинаковый по форме бок из белого ЛДСП и из дуба — две разные позиции.

    Материал входит в идентичность детали наравне с геометрией и толщиной:
    схлопнув их в одну позицию, мы отправим в раскрой не тот лист.
    """
    data = _dxf_bytes(tmp_path, factories.fusion_part, "bok.dxf")
    files = [
        # Алиасы «белый» и «дуб» ведут на материалы разной толщины,
        # поэтому толщину задаём явно шаблоном имени.
        _incoming("Kv_Shkaf_Bok-белый_18_1.dxf", data),
        _incoming("Kv_Shkaf_Bok-дуб_15_1.dxf", data),
    ]
    batch = create_batch(db, name="Один контур, два материала", files=files)
    process_batch(db, batch, ImportOptions())

    parts = db.scalars(select(Part)).all()
    assert len(parts) == 2, "детали разных материалов схлопывать нельзя"
    assert {p.material_id for p in parts} == {materials[0].id, materials[1].id}
    assert all(p.qty == 1 for p in parts)



def test_one_file_with_two_thicknesses_splits_correctly(db, materials, tmp_storage, tmp_path):
    """Один чертёж, два листа разной толщины — обе детали получают свою.

    Пока толщина определялась на файл целиком, половина деталей получала
    чужую: это ровно та потеря принадлежности, ради которой всё затевалось.
    """
    data = _dxf_bytes(
        tmp_path,
        factories.bazis_multi_thickness,
        "mixed.dxf",
        first=(18.0, 1000.0, 600.0),
        second=(15.0, 300.0, 200.0),
    )
    batch = create_batch(db, name="Два листа", files=[_incoming("Raskroy.dxf", data)])
    stats = process_batch(db, batch, ImportOptions())

    parts = db.scalars(select(Part)).all()
    assert stats["failed"] == 0
    assert sorted(p.thickness for p in parts) == [15.0, 18.0]
    assert all(p.thickness_source == "layer_depth" for p in parts)


def test_sheet_sizes_are_detected_from_drawing(db, materials, tmp_storage, tmp_path):
    """Габариты листа читаются из чертежа и предлагаются для склада."""
    data = _dxf_bytes(
        tmp_path, factories.bazis_part, "sheet.dxf", sheet=(2800.0, 2070.0), thickness=18.0
    )
    batch = create_batch(db, name="Габариты", files=[_incoming("Detal.dxf", data)])
    process_batch(db, batch, ImportOptions())

    record = db.scalar(select(ImportFile))
    assert record.detected_sheets == [
        {"index": 0, "w": 2800.0, "h": 2070.0, "bbox": [0.0, -2070.0, 2800.0, 0.0],
         "thickness": 18.0}
    ]
