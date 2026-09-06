"""Тесты порядка работы цеха.

Работа начинается не с файлов, а с раскроя: материал, толщина, оператор. DXF
добавляются в уже созданный раскрой, и на каждый файл оператор отвечает в
диалоге. Дальше лист живёт: «взял в работу» → чеклист → «раскрой завершён».
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import tests.factories as factories
from app.core.db import get_db
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.main import app
from app.models import Material, NestingJob, Part, PartInstance  # noqa: F401
from app.nesting import intake
from app.nesting import service as nesting
from app.tools import service as tools


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def job(db, materials, tmp_storage) -> NestingJob:
    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    return nesting.create_job(
        db, material_id=material.id, thickness=18.0, operator="Севак"
    )


def _files(tmp_path, *, thickness: float = 18.0, count: int = 2) -> list[IncomingFile]:
    out = []
    for index in range(count):
        path = tmp_path / f"Kv12_Shkaf_Bok-{index}_{thickness:g}_2.dxf"
        factories.bazis_part(path, width=600, height=400, thickness=thickness)
        out.append(IncomingFile(path.name, path.name, path.read_bytes()))
    return out


# ------------------------------------------------------- раскрой сначала


def test_job_starts_before_any_file(db, materials):
    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    assert job.stage == "planning"
    assert job.operator == "Севак"
    assert db.scalars(select(Part)).all() == [], "деталей ещё нет — файлов не было"


def test_dialog_prefills_from_filename_and_layers(db, job, tmp_path):
    """Диалог предлагает толщину, проект и изделие, а не спрашивает с нуля."""
    result = intake.analyze(db, job, _files(tmp_path, count=1))
    card = result["files"][0]

    assert card["thickness"] == 18.0
    assert card["detected_thicknesses"] == [18.0], "толщина видна по слоям чертежа"
    assert card["order_name"] == "Kv12", "проект — из имени файла"
    assert card["product_name"] == "Shkaf", "изделие — из имени файла"
    assert card["qty"] == 2
    assert card["parts"] == 1


def test_confirmed_files_land_on_sheets(db, job, tmp_path):
    analyzed = intake.analyze(db, job, _files(tmp_path))
    decisions = [
        {
            "relpath": card["relpath"],
            "thickness": 18.0,
            "order_name": "Квартира 12",
            "product_name": "Шкаф прихожая",
            "grain": "none",
        }
        for card in analyzed["files"]
    ]
    result = intake.confirm(db, job, analyzed["batch_id"], decisions)
    nesting.arrange(db, job)

    assert result["added"] == 2
    assert not result["warnings"]

    parts = db.scalars(select(Part)).all()
    assert {p.order_name for p in parts} == {"Квартира 12"}
    assert {p.product_name for p in parts} == {"Шкаф прихожая"}
    assert all(p.thickness_source == "manual" for p in parts), (
        "оператор подтвердил толщину сам — это не догадка резолвера"
    )
    placed = [i for i in db.scalars(select(PartInstance)).all() if i.sheet_id]
    assert len(placed) == 4, "две детали по два экземпляра"


def test_file_not_confirmed_is_not_imported(db, job, tmp_path):
    """Файл, который оператор убрал из диалога, деталей не даёт."""
    analyzed = intake.analyze(db, job, _files(tmp_path))
    keep = analyzed["files"][0]
    intake.confirm(
        db,
        job,
        analyzed["batch_id"],
        [{"relpath": keep["relpath"], "thickness": 18.0}],
    )
    sources = {p.source_file for p in db.scalars(select(Part)).all()}
    assert sources == {keep["relpath"]}


def test_thickness_conflict_is_reported_not_hidden(db, job, tmp_path):
    """Один файл — одна толщина, но расхождение со слоями не замалчивается."""
    files = _files(tmp_path, thickness=16.0, count=1)
    analyzed = intake.analyze(db, job, files)
    result = intake.confirm(
        db,
        job,
        analyzed["batch_id"],
        [{"relpath": analyzed["files"][0]["relpath"], "thickness": 18.0}],
    )
    assert any("16" in warning for warning in result["warnings"]), result["warnings"]


def test_parts_of_other_thickness_do_not_join_this_job(db, job, tmp_path):
    """Деталь 12 мм не уедет на лист 18 мм — про это прямо сказано."""
    analyzed = intake.analyze(db, job, _files(tmp_path, thickness=12.0, count=1))
    result = intake.confirm(
        db,
        job,
        analyzed["batch_id"],
        [{"relpath": analyzed["files"][0]["relpath"], "thickness": 12.0}],
    )
    assert result["added"] == 0
    assert any("12 мм" in warning for warning in result["warnings"])


# --------------------------------------------------- взял в работу → чеклист


def test_checklist_gates_finishing(db, job):
    with pytest.raises(nesting.NestingError, match="возьмите раскрой в работу"):
        nesting.finish(db, job)

    nesting.take(db, job, "Севак")
    assert job.stage == "in_progress"

    with pytest.raises(nesting.NestingError, match="Маркировка"):
        nesting.finish(db, job)

    nesting.set_checklist(db, job, {"marking": True, "sorted": True})
    with pytest.raises(nesting.NestingError, match="посчитано"):
        nesting.finish(db, job)

    nesting.set_checklist(db, job, {"counted": True})
    nesting.finish(db, job)
    assert job.stage == "finished"
    assert job.finished_at is not None


def test_operator_name_is_required(db, job):
    with pytest.raises(nesting.NestingError, match="Назовите оператора"):
        nesting.take(db, job, "   ")


def test_api_workflow(client, db, job):
    taken = client.post(f"/api/nesting/jobs/{job.id}/take", json={"operator": "Севак"})
    assert taken.json()["stage"] == "in_progress"

    early = client.post(f"/api/nesting/jobs/{job.id}/finish")
    assert early.status_code == 400
    assert "Маркировка" in early.json()["detail"]

    client.put(
        f"/api/nesting/jobs/{job.id}/checklist",
        json={"items": {"marking": True, "sorted": True, "counted": True}},
    )
    done = client.post(f"/api/nesting/jobs/{job.id}/finish")
    assert done.status_code == 200
    assert done.json()["stage"] == "finished"


# ------------------------------------------------------------ библиотека фрез


def test_tool_library_knows_the_magazine(db):
    tools.sync_tools(db)
    magazine = tools.magazine(db)
    assert len(magazine) == 8, "в магазине станка восемь слотов"

    occupied = [slot for slot in magazine if slot["tool_id"]]
    assert len(occupied) == 6, "две фрезы лежат вне магазина"

    spiral = next(t for t in tools.all_tools(db) if t.name.startswith("Спиральная"))
    state = tools.resource_state(spiral)
    assert state["low"], "264 из 300 м — ресурс на исходе"
    assert spiral.min_radius == 3.0, "фреза ⌀6 не выберет угол острее R3"


def test_tool_api_lists_and_updates(client, db):
    listed = client.get("/api/tools").json()
    assert listed["slots"] == 8
    assert len(listed["tools"]) == 8

    tool = next(t for t in listed["tools"] if t["slot"] == 2)
    assert tool["usage"], "фреза контура названа в пресетах раскроя"

    replaced = client.post(f"/api/tools/{tool['id']}/resource", json={"used": 0})
    assert replaced.json()["resource"]["used"] == 0
    assert replaced.json()["resource"]["low"] is False


# ------------------------------------------------- склад закрывается сам


def test_finished_job_writes_off_sheets_and_keeps_offcut(db, materials, tmp_path, tmp_storage):
    """«Раскрой завершён» закрывает круг: лист ушёл, обрезок вернулся.

    Это ровно тот сценарий, который назвал заказчик: отрезал лист — лист со
    склада исчез, а крупный остаток остался, чтобы пустить его в дело.
    """
    from app.stock import service as stock

    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    stock.receive(db, material_id=material.id, w=material.sheet_w, h=material.sheet_h, qty=3)

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    analyzed = intake.analyze(db, job, _files(tmp_path, count=1))
    intake.confirm(
        db, job, analyzed["batch_id"],
        [{"relpath": analyzed["files"][0]["relpath"], "thickness": 18.0}],
    )
    nesting.arrange(db, job)

    def sheets_left() -> int:
        items = stock.available_items(db, material_id=material.id, kind="sheet")
        return sum(item.qty for item in items)

    before = sheets_left()

    nesting.take(db, job, "Севак")
    nesting.set_checklist(db, job, {"marking": True, "sorted": True, "counted": True})
    nesting.finish(db, job)

    assert sheets_left() == before - 1, "лист под фрезой списан со склада"

    offcuts = stock.available_items(db, material_id=material.id, kind="offcut")
    assert offcuts, "крупный остаток вернулся на склад деловым отходом"
    assert offcuts[0].note and f"раскрой №{job.id}" in offcuts[0].note


def test_stock_untouched_when_disabled_in_config(db, materials, monkeypatch, tmp_storage):
    """Если склад ведётся в другой системе — платформа в него не лезет."""
    from app.core import config_files
    from app.stock import service as stock

    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    stock.receive(db, material_id=material.id, w=material.sheet_w, h=material.sheet_h, qty=2)
    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")

    original = config_files.app_config()
    patched = {**original, "stock": {**original.get("stock", {}), "consume_on_cut": False}}
    monkeypatch.setattr(config_files, "app_config", lambda: patched)

    result = nesting.consume_stock(db, job)
    assert result["consumed"] == 0
    assert result["skipped"]


# --------------------------------------------- два раскроя не делят детали


def test_two_jobs_of_same_thickness_do_not_steal_parts(db, materials, tmp_path, tmp_storage):
    """Соседний раскрой той же толщины не должен трогать чужие детали.

    Раньше выборка шла по паре «материал + толщина», и второй раскрой 18 мм
    забирал детали первого: пересчёт разбрасывал уже разложенные листы.
    """
    material = db.scalar(select(Material).where(Material.thickness == 18.0))

    first = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    analyzed = intake.analyze(db, first, _files(tmp_path, count=1))
    intake.confirm(
        db, first, analyzed["batch_id"],
        [{"relpath": analyzed["files"][0]["relpath"], "thickness": 18.0}],
    )
    nesting.arrange(db, first)
    placed_first = {i.id: (i.x, i.y) for i, _ in nesting.job_instances(db, first) if i.sheet_id}
    assert placed_first

    second = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Пётр")
    assert nesting.job_instances(db, second) == [], "чужие детали второму раскрою не видны"
    with pytest.raises(nesting.NestingError, match="нет готовых деталей"):
        nesting.arrange(db, second)

    for instance, _ in nesting.job_instances(db, first):
        if instance.id in placed_first:
            assert (instance.x, instance.y) == placed_first[instance.id], (
                "первый раскрой остался нетронутым"
            )


def test_free_parts_are_claimed_by_the_job_that_places_them(db, materials, tmp_path, tmp_storage):
    """Деталь из старого импорта достаётся тому раскрою, который её разложил."""
    material = db.scalar(select(Material).where(Material.thickness == 18.0))
    batch = create_batch(db, name="Мимо раскроя", files=_files(tmp_path, count=1))
    process_batch(db, batch, ImportOptions())
    for part in db.scalars(select(Part)).all():
        part.material_id = material.id
        part.status = "ready"
        part.thickness = 18.0
    db.flush()

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    assert nesting.job_instances(db, job), "свободная деталь видна раскрою"
    nesting.arrange(db, job)

    claimed = {part.job_id for _, part in nesting.job_instances(db, job)}
    assert claimed == {job.id}, "после раскладки деталь закреплена за раскроем"


def test_duplicate_spec_keys_do_not_break_the_upload(db, tmp_path, tmp_storage):
    """«Полка» в спецификации десять раз — загрузка обязана выжить."""
    spec = tmp_path / "spec.csv"
    spec.write_text(
        "Наименование;Кол-во;Длина;Ширина;Толщина\n"
        "Полка;2;600;300;18\n"
        "Полка;3;800;300;18\n",
        encoding="utf-8",
    )
    files = _files(tmp_path, count=1)
    files.append(IncomingFile("spec.csv", "spec.csv", spec.read_bytes()))

    batch = create_batch(db, name="Спецификация с дублями", files=files)
    stats = batch.stats or {}
    assert stats.get("spec_duplicates") == 1
    assert any("повторяются ключи" in w for w in stats.get("spec_warnings", []))


def test_finished_job_cannot_be_rearranged(db, job, tmp_path):
    """Завершённый раскрой не переставляется.

    Лист отрезан, детали размечены и посчитаны, лист списан со склада. Если
    после этого переложить карту, маркировка на деталях перестанет совпадать
    с экраном — а именно по ней их и раскладывают по проектам.
    """
    analyzed = intake.analyze(db, job, _files(tmp_path, count=1))
    intake.confirm(
        db, job, analyzed["batch_id"],
        [{"relpath": analyzed["files"][0]["relpath"], "thickness": 18.0}],
    )
    nesting.arrange(db, job)
    instance = next(i for i, _ in nesting.job_instances(db, job) if i.x is not None)

    nesting.take(db, job, "Севак")
    nesting.set_checklist(db, job, {key: True for key, _ in nesting.CHECKLIST})
    nesting.finish(db, job)

    with pytest.raises(nesting.NestingError, match="завершён"):
        nesting.arrange(db, job)

    with pytest.raises(nesting.NestingError, match="завершён"):
        nesting.move_instances(db, job, [{"instance_id": instance.id, "x": 5.0}])

    later = intake.analyze(db, job, _files(tmp_path, count=1))
    with pytest.raises(nesting.NestingError, match="завершён"):
        intake.confirm(
            db, job, later["batch_id"],
            [{"relpath": later["files"][0]["relpath"], "thickness": 18.0}],
        )


def test_job_thickness_must_match_the_material(db, materials):
    """Толщина — часть идентичности материала, а не его параметр.

    «ЛДСП 16» и «ЛДСП 28» — две разные записи справочника. Раскрой,
    заведённый на одной записи с толщиной другой, взял бы формат листа и
    обрезку кромок от первой, а глубины резания от второй: фреза ушла бы на
    двенадцать миллиметров мимо. В интерфейсе так не сделать, через API было
    можно.
    """
    material = db.scalar(select(Material).where(Material.thickness == 18.0))

    with pytest.raises(nesting.NestingError, match="18 мм"):
        nesting.create_job(db, material_id=material.id, thickness=16.0, operator="Севак")

    job = nesting.create_job(db, material_id=material.id, thickness=18.0, operator="Севак")
    assert job.thickness == 18.0
