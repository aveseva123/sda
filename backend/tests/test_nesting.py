"""Тесты раскладки: укладка по листам, ручные правки, коллизии."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import tests.factories as factories
from app.core.db import get_db
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.main import app
from app.models import GrainMode, Material, Part, PartInstance, PartStatus, Sheet
from app.nesting import Piece, allowed_rotations, pack
from app.nesting import service as nesting


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ------------------------------------------------------------- укладчик


def _pieces(sizes: list[tuple[float, float]]) -> list[Piece]:
    return [
        Piece(instance_id=index, part_id=1, w=w, h=h)
        for index, (w, h) in enumerate(sizes)
    ]


def test_no_overlaps_in_generated_layout():
    """Главное свойство укладки: детали не налезают друг на друга."""
    sizes = [(600, 400), (600, 400), (800, 300), (1200, 500), (300, 200), (900, 700)]
    pieces = _pieces(sizes)
    result = pack(pieces, sheet_w=2800, sheet_h=2070, trim=(10, 10, 10, 10))
    by_id = {p.instance_id: p for p in pieces}

    for plan in result.sheets:
        rects = []
        for placement in plan.placements:
            piece = by_id[placement.instance_id]
            w, h = piece.size(placement.rotation)
            rects.append((placement.x, placement.y, w, h))
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                ax, ay, aw, ah = rects[i]
                bx, by, bw, bh = rects[j]
                separated = (
                    ax + aw <= bx + 0.001
                    or bx + bw <= ax + 0.001
                    or ay + ah <= by + 0.001
                    or by + bh <= ay + 0.001
                )
                assert separated, f"детали {i} и {j} пересекаются"


def test_parts_stay_inside_the_usable_area():
    """Обрезка кромок листа обязана соблюдаться."""
    pieces = _pieces([(2790, 2060)])
    result = pack(pieces, sheet_w=2800, sheet_h=2070, trim=(10, 10, 10, 10))
    # Деталь 2790×2060 в полезную область 2780×2050 не влезает.
    assert result.unplaced == [0]


def test_oversized_part_is_reported_not_silently_dropped():
    result = pack(_pieces([(3000, 500)]), sheet_w=2800, sheet_h=2070)
    assert result.unplaced == [0]
    assert result.warnings


def test_grain_limits_rotation():
    """Текстурную деталь нельзя класть поперёк волокна."""
    assert allowed_rotations(GrainMode.ALONG_LENGTH, has_grain=True) == [0.0, 180.0]
    assert allowed_rotations(GrainMode.NONE, has_grain=False) == [0.0, 90.0, 180.0, 270.0]


def test_pinned_pieces_keep_their_place():
    pieces = _pieces([(600, 400), (800, 300)])
    pieces[0].pinned = True
    pieces[0].x = 1500
    pieces[0].y = 900
    result = pack(pieces, sheet_w=2800, sheet_h=2070, trim=(10, 10, 10, 10))

    pinned = next(
        p for plan in result.sheets for p in plan.placements if p.instance_id == 0
    )
    assert (pinned.x, pinned.y) == (1500, 900)


# ------------------------------------------------------------- задание


@pytest.fixture
def job_ready(db, materials, tmp_storage, tmp_path):
    """Пачка деталей 18 мм, готовая к раскрою."""
    files = []
    for index in range(4):
        path = tmp_path / f"d{index}.dxf"
        factories.bazis_part(path, width=600 + index * 100, height=400, thickness=18.0)
        files.append(
            IncomingFile(
                f"Kv_Shkaf_Detal-{index}_18_2.dxf",
                f"Kv_Shkaf_Detal-{index}_18_2.dxf",
                path.read_bytes(),
            )
        )
    batch = create_batch(db, name="Раскрой", files=files)
    process_batch(db, batch, ImportOptions())

    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    for part in db.scalars(select(Part)).all():
        part.material_id = material.id
        part.status = PartStatus.READY
    db.flush()
    return material


def test_job_places_every_instance(db, job_ready):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)

    instances = db.scalars(select(PartInstance)).all()
    assert len(instances) == 8, "четыре детали по два экземпляра"
    assert all(i.sheet_id is not None for i in instances), "все должны лечь на лист"
    assert job.utilization and job.utilization > 0


def test_job_ignores_parts_that_need_clarification(db, job_ready):
    """Деталь без подтверждённой толщины в раскрой не идёт: уедет на чужой лист."""
    part = db.scalar(select(Part))
    part.status = PartStatus.NEEDS_CLARIFICATION
    db.flush()

    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    placed = {i.part_id for i in db.scalars(select(PartInstance)).all() if i.sheet_id}
    assert part.id not in placed
    del job


def test_manual_move_pins_the_part(db, job_ready):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    instance = db.scalars(select(PartInstance)).first()

    nesting.move_instances(
        db, job, [{"instance_id": instance.id, "x": 1200.0, "y": 800.0, "rotation": 90.0}]
    )
    db.refresh(instance)
    assert (instance.x, instance.y, instance.rotation) == (1200.0, 800.0, 90.0)
    assert instance.pinned, "ручная правка закрепляет деталь"

    # Пересчёт не должен сдвинуть закреплённую деталь.
    nesting.arrange(db, job)
    db.refresh(instance)
    assert (instance.x, instance.y) == (1200.0, 800.0)


def test_collisions_are_reported_but_not_blocked(db, job_ready):
    """Технологу можно поставить детали внахлёст — но он должен это увидеть."""
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    first, second = db.scalars(select(PartInstance)).all()[:2]
    sheet = db.scalar(select(Sheet).where(Sheet.job_id == job.id))

    nesting.move_instances(
        db,
        job,
        [
            {"instance_id": first.id, "sheet_index": sheet.index, "x": 100.0, "y": 100.0},
            {"instance_id": second.id, "sheet_index": sheet.index, "x": 110.0, "y": 110.0},
        ],
    )

    issues = nesting.collisions(db, job)
    assert any(i["kind"] == "overlap" for i in issues)
    assert {first.id, second.id} <= set(sum((i["instance_ids"] for i in issues), []))


def test_auto_arranged_layout_has_no_collisions(db, job_ready):
    """Свежая автораскладка обязана быть чистой — иначе алгоритм врёт."""
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    assert nesting.collisions(db, job) == []


def test_layout_payload_has_everything_the_canvas_needs(db, job_ready):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    payload = nesting.layout_payload(db, job)

    assert payload["sheets"], "листы"
    assert payload["instances"], "экземпляры с координатами"
    part = next(iter(payload["parts"].values()))
    assert part["geometry"]["outer"], "геометрия для отрисовки"
    assert part["style"]["fill"].startswith("#"), "цвет проекта"
    assert part["vectors"], "векторы с назначенными траекториями"
    assert payload["sheets"][0]["trim"]["left"] >= 0, "обрезка кромок для полезной области"


def test_new_job_starts_empty(db, materials):
    """Работа начинается с раскроя, а не с файлов: пустое задание — норма.

    Файлы добавляются в уже созданный раскрой, поэтому отсутствие деталей на
    старте не ошибка. Ошибкой это становится только при попытке разложить.
    """
    job = nesting.create_job(db, material_id=materials[0].id, thickness=18.0)
    assert job.id is not None
    assert job.stage == "planning"
    assert db.scalars(select(Sheet).where(Sheet.job_id == job.id)).all() == []

    with pytest.raises(nesting.NestingError, match="нет готовых деталей"):
        nesting.arrange(db, job)


# ----------------------------------------------------------------- API


def test_api_full_editor_cycle(client, db, job_ready):
    created = client.post(
        "/api/nesting/jobs", json={"material_id": job_ready.id, "thickness": 18.0}
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    layout = client.get(f"/api/nesting/jobs/{job_id}/layout").json()
    assert layout["instances"]
    instance = layout["instances"][0]

    moved = client.post(
        f"/api/nesting/jobs/{job_id}/move",
        json={
            "moves": [
                {"instance_id": instance["id"], "x": 500.0, "y": 500.0, "rotation": 90.0}
            ]
        },
    )
    assert moved.status_code == 200, moved.text

    after = client.get(f"/api/nesting/jobs/{job_id}/layout").json()
    updated = next(i for i in after["instances"] if i["id"] == instance["id"])
    assert (updated["x"], updated["y"], updated["rotation"]) == (500.0, 500.0, 90.0)
    assert updated["pinned"]

    assert client.get(f"/api/nesting/jobs/{job_id}/collisions").status_code == 200


def test_api_move_to_unknown_sheet_is_rejected(client, db, job_ready):
    job_id = client.post(
        "/api/nesting/jobs", json={"material_id": job_ready.id, "thickness": 18.0}
    ).json()["id"]
    layout = client.get(f"/api/nesting/jobs/{job_id}/layout").json()

    response = client.post(
        f"/api/nesting/jobs/{job_id}/move",
        json={"moves": [{"instance_id": layout["instances"][0]["id"], "sheet_index": 99}]},
    )
    assert response.status_code == 400
    assert "нет в задании" in response.json()["detail"]


def test_tall_parts_do_not_overlap_on_the_sheet(db, materials):
    """Вертикальная на чертеже деталь не должна укладываться как горизонтальная.

    ``part.length``/``part.width`` — это больший и меньший размеры: они не
    помнят, как деталь лежит. Раскладчик считал по ним и резервировал под
    стойку 1954×630 место 1954 в ширину, ставя следующую стойку через 630 мм
    по высоте. На листе они при этом стоят вертикально и налезают друг на
    друга на 1300 мм — а холст рисует настоящую геометрию, и раскрой уходит
    на станок с наложением.
    """
    material = db.scalar(select(Material).where(Material.thickness == 18.0))

    for number in (1, 2):
        part = Part(
            name=f"Стойка {number}",
            material_id=material.id,
            thickness=18.0,
            status=PartStatus.READY,
            qty=1,
            length=1954.0,
            width=630.0,
            grain=GrainMode.NONE,
            # На чертеже деталь стоит вертикально: 630 по X, 1954 по Y.
            geometry={
                "outer": [[0, 0], [630, 0], [630, 1954], [0, 1954]],
                "inners": [],
                "operations": [],
                "bbox": [0.0, 0.0, 630.0, 1954.0],
                "length": 1954.0,
                "width": 630.0,
                "area": 630.0 * 1954.0,
            },
        )
        db.add(part)
        db.flush()
        db.add(PartInstance(part_id=part.id, uid=f"TALL-{number:03d}"))
    db.flush()

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    nesting.arrange(db, job)

    placed = []
    for instance, part in nesting.job_instances(db, job):
        w, h = nesting.part_footprint(part)
        if int(instance.rotation or 0) % 180 == 90:
            w, h = h, w
        placed.append((instance.sheet_id, instance.x, instance.y, w, h))

    for i in range(len(placed)):
        for j in range(i + 1, len(placed)):
            sheet_a, ax, ay, aw, ah = placed[i]
            sheet_b, bx, by, bw, bh = placed[j]
            if sheet_a != sheet_b:
                continue
            separated = (
                ax + aw <= bx + 0.001
                or bx + bw <= ax + 0.001
                or ay + ah <= by + 0.001
                or by + bh <= ay + 0.001
            )
            assert separated, "стойки налезли друг на друга"

    for _, part in nesting.job_instances(db, job):
        assert nesting.part_footprint(part) == (630.0, 1954.0)


def test_full_rearrange_clears_manual_pinning(db, materials, tmp_path, tmp_storage):
    """Полный пересчёт снимает закрепление: ручного места после него нет.

    Флаг ``pinned`` значит «эту деталь поставил человек». «Разложить заново»
    её всё равно переложило, поэтому оставлять флаг нельзя: следующее
    «Уплотнить» замораживало бы координаты, выбранные машиной, и переставало
    бы что-либо делать.
    """
    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    path = tmp_path / "Kv12_Shkaf_Bok_18_2.dxf"
    factories.bazis_part(path, width=600, height=400, thickness=18.0)
    batch = create_batch(
        db,
        name="Партия",
        files=[IncomingFile(path.name, path.name, path.read_bytes())],
    )
    process_batch(db, batch, ImportOptions())
    for part in db.scalars(select(Part)).all():
        part.material_id = material.id
        part.thickness = 18.0
        part.status = PartStatus.READY
    db.flush()

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    nesting.arrange(db, job)
    assert nesting.job_instances(db, job)
    for instance, _ in nesting.job_instances(db, job):
        instance.pinned = True
    db.flush()

    nesting.arrange(db, job, keep_pinned=True)
    assert all(i.pinned for i, _ in nesting.job_instances(db, job)), (
        "«Уплотнить» закрепление не трогает"
    )

    nesting.arrange(db, job, keep_pinned=False)
    assert not any(i.pinned for i, _ in nesting.job_instances(db, job)), (
        "«Разложить заново» снимает закрепление"
    )


def test_utilization_does_not_change_from_nudging_a_part(db, materials, tmp_path, tmp_storage):
    """КИМ не должен прыгать оттого, что деталь сдвинули на миллиметр.

    Укладчик делил полезную площадь на площадь ЗА ВЫЧЕТОМ обрезки кромок, а
    пересчёт после ручной правки — на полную площадь листа. Оператор видел
    «91 %» сразу после раскладки и «89,6 %» после сдвига детали на 1 мм, не
    сделав ничего осмысленного.
    """
    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    path = tmp_path / "Kv12_Shkaf_Bok_18_2.dxf"
    factories.bazis_part(path, width=600, height=400, thickness=18.0)
    batch = create_batch(
        db, name="Партия", files=[IncomingFile(path.name, path.name, path.read_bytes())]
    )
    process_batch(db, batch, ImportOptions())
    for part in db.scalars(select(Part)).all():
        part.material_id = material.id
        part.thickness = 18.0
        part.status = PartStatus.READY
    db.flush()

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    after_arrange = nesting.arrange(db, job)["utilization"]

    instance = next(i for i, _ in nesting.job_instances(db, job) if i.x is not None)
    nesting.move_instances(
        db, job, [{"instance_id": instance.id, "x": float(instance.x) + 1.0}]
    )

    assert job.utilization == pytest.approx(after_arrange, abs=0.0005), (
        "сдвиг детали не меняет КИМ"
    )
