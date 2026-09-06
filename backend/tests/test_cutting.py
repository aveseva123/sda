"""Тесты пресетов раскроя.

Пресет — это словарь ArtCAM, применённый не к отдельной траектории, а к
материалу. Проверяется главное: пресет подбирается по паре «материал +
толщина», не подбирается наугад, доходит до раскладки и остаётся в
задании снимком, чтобы старую УП можно было повторить точь-в-точь.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import tests.factories as factories
from app.core.db import get_db
from app.cutting import service as cutting
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.main import app
from app.models import CuttingPreset, Material, Part, PartInstance, PartStatus
from app.nesting import service as nesting


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def job_ready(db, materials, tmp_path, tmp_storage) -> Material:
    """Готовые к раскрою детали 18 мм — та же пачка, что в тестах раскладки."""
    files = []
    for index in range(3):
        path = tmp_path / f"p{index}.dxf"
        factories.bazis_part(path, width=600, height=400, thickness=18.0)
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


# ---------------------------------------------------- синхронизация с конфигом


def test_presets_come_from_config(db):
    created = cutting.sync_presets(db)
    slugs = {p.slug for p in created}
    assert {"ldsp_16", "ldsp_18", "hdf_4_groove"} <= slugs

    preset = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == "ldsp_16"))
    assert preset.thickness() == 16.0
    assert preset.order == ["DRILL", "GROOVE", "POCKET", "INNER", "OUTER"], (
        "контур режется последним, иначе отрезанная деталь поедет под фрезой"
    )
    assert preset.is_default


def test_sync_is_idempotent(db):
    cutting.sync_presets(db)
    assert cutting.sync_presets(db) == [], "повторная синхронизация не плодит копии"
    assert len(db.scalars(select(CuttingPreset)).all()) == 3


def test_config_does_not_overwrite_technologist_edits(db):
    cutting.sync_presets(db)
    preset = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == "ldsp_16"))
    preset.is_builtin = False
    preset.placement = {**preset.placement, "part_gap": 25.0}
    db.flush()

    cutting.sync_presets(db)
    db.refresh(preset)
    assert preset.placement["part_gap"] == 25.0


# --------------------------------------------------------------- подбор фрезы


def test_drill_tool_is_picked_by_diameter(db):
    cutting.sync_presets(db)
    preset = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == "ldsp_16"))

    assert preset.tool_for("OUTER")["diameter"] == 8.0
    assert preset.tool_for("DRILL", 15.0)["slot"] == "T5"
    # Нестандартный диаметр — ближайшая фреза, а не отказ.
    assert preset.tool_for("DRILL", 9.0)["diameter"] == 8.0
    assert preset.tool_for("MARK") is None


# ------------------------------------------------------------------- подбор


def test_preset_matches_material_and_thickness(db, materials):
    ldsp18 = next(m for m in materials if m.thickness == 18.0)
    preset = cutting.preset_for(db, material=ldsp18, thickness=18.0)
    assert preset is not None and preset.slug == "ldsp_18"


def test_no_preset_for_unknown_thickness(db, materials):
    """Пресет на 18 мм нельзя молча применить к 30 мм: подрез уйдёт в стол."""
    massiv = next(m for m in materials if m.thickness == 30.0)
    assert cutting.preset_for(db, material=massiv, thickness=30.0) is None


def test_material_name_narrows_the_match(db, materials):
    """Толщина совпала, а материал другой — пресет ЛДСП не подходит ХДФ."""
    hdf = next(m for m in materials if m.name == "ХДФ")
    hdf.thickness = 16.0
    db.flush()
    assert cutting.preset_for(db, material=hdf, thickness=16.0) is None


# ------------------------------------------------------- влияние на раскладку


def test_gap_is_tool_diameter_plus_bridge(db, materials):
    cutting.sync_presets(db)
    preset = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == "ldsp_18"))
    ldsp18 = next(m for m in materials if m.thickness == 18.0)

    params = cutting.placement_params(preset)
    assert params["kerf"] == 8.0, "рез — это полный диаметр фрезы контура"
    assert params["part_gap"] == 2.0
    assert params["sheet_margin"] == 12.0
    assert "trim" not in params, (
        "обрезка кромок — свойство партии листов, её держит карточка материала"
    )
    del ldsp18


def test_job_remembers_the_preset_it_was_computed_with(db, job_ready):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)

    assert job.preset_id is not None
    snapshot = job.preset_snapshot
    assert snapshot["slug"] == "ldsp_18"
    assert snapshot["layout"]["kerf"] == 8.0
    assert snapshot["order"][-1] == "OUTER"

    # Правка пресета не должна менять уже посчитанное задание.
    preset = db.get(CuttingPreset, job.preset_id)
    preset.placement = {**preset.placement, "part_gap": 40.0}
    db.flush()
    assert job.preset_snapshot["layout"]["part_gap"] == 2.0


def test_preset_gap_is_respected_on_the_sheet(db, job_ready):
    """Между контурами деталей остаётся диаметр фрезы плюс мостик."""
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    gap = 8.0 + 2.0

    parts = {part.id: part for _, part in nesting.job_instances(db, job)}
    boxes: dict[int, list[tuple[float, float, float, float]]] = {}
    for instance in db.scalars(select(PartInstance)).all():
        if instance.sheet_id is None:
            continue
        part = parts[instance.part_id]
        w, h = float(part.length), float(part.width)
        if int(instance.rotation or 0) % 180 == 90:
            w, h = h, w
        boxes.setdefault(instance.sheet_id, []).append((instance.x, instance.y, w, h))

    for items in boxes.values():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                ax, ay, aw, ah = items[i]
                bx, by, bw, bh = items[j]
                assert (
                    ax + aw + gap <= bx + 0.001
                    or bx + bw + gap <= ax + 0.001
                    or ay + ah + gap <= by + 0.001
                    or by + bh + gap <= ay + 0.001
                ), "детали стоят ближе, чем пройдёт фреза"


def test_last_utilization_lands_on_the_preset(db, job_ready):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    preset = db.get(CuttingPreset, job.preset_id)
    assert preset.last_utilization == job.utilization


# ---------------------------------------------------------------------- API


def test_api_lists_and_matches_presets(client, materials):
    response = client.get("/api/cutting-presets")
    assert response.status_code == 200
    slugs = {p["slug"] for p in response.json()}
    assert {"ldsp_16", "ldsp_18", "hdf_4_groove"} <= slugs

    ldsp18 = next(m for m in materials if m.thickness == 18.0)
    matched = client.get(
        "/api/cutting-presets/match",
        params={"material_id": ldsp18.id, "thickness": 18.0},
    )
    assert matched.json()["slug"] == "ldsp_18"

    massiv = next(m for m in materials if m.thickness == 30.0)
    empty = client.get(
        "/api/cutting-presets/match",
        params={"material_id": massiv.id, "thickness": 30.0},
    )
    assert empty.json() is None, "подходящего пресета нет — так и говорим"


def test_api_edit_detaches_preset_from_config(client):
    preset = next(p for p in client.get("/api/cutting-presets").json() if p["slug"] == "ldsp_16")
    payload = {
        key: preset[key]
        for key in (
            "slug", "name", "applies_to", "placement", "depth",
            "strategy", "tools", "order", "safety", "post", "is_default",
        )
    }
    payload["placement"] = {**payload["placement"], "part_gap": 3.5}

    updated = client.put(f"/api/cutting-presets/{preset['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["is_builtin"] is False
    assert updated.json()["placement"]["part_gap"] == 3.5

    # Повторный листинг синхронизируется с конфигом и не затирает правку.
    again = next(p for p in client.get("/api/cutting-presets").json() if p["slug"] == "ldsp_16")
    assert again["placement"]["part_gap"] == 3.5


def test_api_changes_preset_on_a_job(client, job_ready, db):
    job = nesting.create_job(db, material_id=job_ready.id, thickness=18.0)
    other = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == "hdf_4_groove"))

    response = client.put(
        f"/api/nesting/jobs/{job.id}/preset", json={"preset_id": other.id}
    )
    assert response.status_code == 200
    assert response.json()["preset"]["slug"] == "hdf_4_groove"
    assert response.json()["layout"]["sheets"] >= 1

    layout = client.get(f"/api/nesting/jobs/{job.id}/layout").json()
    assert layout["job"]["preset"]["slug"] == "hdf_4_groove"
