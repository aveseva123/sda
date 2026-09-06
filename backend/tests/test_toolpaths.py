"""Тесты пресетов траекторий и их назначения на векторы детали."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import tests.factories as factories
from app.core.db import get_db
from app.importer import ImportOptions, IncomingFile, create_batch, process_batch
from app.main import app
from app.models import Part, PartToolpath, ToolpathPreset
from app.toolpath import service


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def imported_part(db, materials, tmp_storage, tmp_path) -> Part:
    """Деталь из «Базиса»: контур, вырез, присадка, выборка."""
    path = tmp_path / "detal.dxf"
    factories.bazis_part(path, thickness=18.0, inset_depth=12.0, drill_diameter=8.0)
    batch = create_batch(
        db,
        name="Траектории",
        files=[IncomingFile("Kv_Shkaf_Bok_18_1.dxf", "Kv_Shkaf_Bok_18_1.dxf", path.read_bytes())],
    )
    process_batch(db, batch, ImportOptions())
    return db.scalar(select(Part))


def test_presets_come_from_config(db):
    service.sync_presets(db)
    slugs = {p.slug for p in db.scalars(select(ToolpathPreset)).all()}
    assert {"profile_outside", "profile_inside", "pocket", "drill", "groove_center"} <= slugs


def test_sync_is_idempotent(db):
    service.sync_presets(db)
    first = len(db.scalars(select(ToolpathPreset)).all())
    service.sync_presets(db)
    assert len(db.scalars(select(ToolpathPreset)).all()) == first


def test_preset_edited_by_user_is_not_overwritten_by_config(db):
    service.sync_presets(db)
    preset = service.preset_by_slug(db, "pocket")
    preset.is_builtin = False
    preset.name = "Мой карман"
    db.flush()

    service.sync_presets(db)
    assert service.preset_by_slug(db, "pocket").name == "Мой карман"


def test_vectors_are_listed_in_technologists_order(imported_part):
    vectors = service.vectors_of(imported_part).vectors
    targets = [v.target for v in vectors]

    assert targets[0] == "outer", "внешний контур идёт первым"
    assert any(t.startswith("op:") for t in targets), "операции тоже адресуемы"
    drills = [v for v in vectors if v.semantic == "DRILL"]
    assert len(drills) == 3
    assert all(v.diameter == 8.0 for v in drills)
    assert all("⌀8" in v.title for v in drills), "в названии виден диаметр"


def test_toolpaths_are_assigned_automatically_on_import(db, imported_part):
    rows = db.scalars(
        select(PartToolpath).where(PartToolpath.part_id == imported_part.id)
    ).all()
    assert rows, "после импорта деталь уже должна быть готова к обработке"

    by_target = {row.target: row for row in rows}
    presets = {p.id: p for p in db.scalars(select(ToolpathPreset)).all()}
    assert presets[by_target["outer"].preset_id].slug == "profile_outside"

    drill_targets = [
        target
        for target, row in by_target.items()
        if presets[row.preset_id].slug == "drill"
    ]
    assert len(drill_targets) == 3


def test_manual_assignment_wins_over_auto(db, imported_part):
    service.sync_presets(db)
    engrave = service.preset_by_slug(db, "engrave")
    service.assign(db, part_id=imported_part.id, targets=["outer"], preset_id=engrave.id)

    # Повторная автораздача не должна затирать ручное решение технолога.
    service.auto_assign(db, imported_part)
    row = db.scalar(
        select(PartToolpath).where(
            PartToolpath.part_id == imported_part.id, PartToolpath.target == "outer"
        )
    )
    assert row.preset_id == engrave.id
    assert row.assigned_manually


def test_assigning_to_missing_vector_is_rejected(db, imported_part):
    service.sync_presets(db)
    preset = service.preset_by_slug(db, "drill")
    with pytest.raises(ValueError, match="нет векторов"):
        service.assign(
            db, part_id=imported_part.id, targets=["inner:99"], preset_id=preset.id
        )


@pytest.mark.parametrize(
    ("mode", "layer_depth", "thickness", "expected"),
    [
        # Глубина из слоя достовернее всего: её написал конструктор.
        ("from_layer", 12.0, 18.0, 12.0),
        # Слой глубину не несёт — режем насквозь с подрезом.
        ("from_layer", None, 18.0, 18.5),
        ("through", None, 16.0, 16.5),
        ("fixed", 12.0, 18.0, 8.0),
    ],
)
def test_depth_resolution_order(db, mode, layer_depth, thickness, expected):
    preset = ToolpathPreset(
        slug=f"t-{mode}-{layer_depth}",
        name="тест",
        side="outside",
        depth={"mode": mode, "fallback": "through", "overcut": 0.5, "value": 8.0},
    )
    assert (
        service.resolve_depth(preset, layer_depth=layer_depth, thickness=thickness)
        == expected
    )


def test_api_lists_vectors_with_resolved_depth(client, imported_part):
    response = client.get(f"/api/parts/{imported_part.id}/vectors")
    assert response.status_code == 200, response.text
    data = response.json()

    outer = next(v for v in data["vectors"] if v["target"] == "outer")
    assert outer["preset_name"] == "Контур наружу"
    # Внешний контур режется насквозь: толщина 18 + подрез 0.5.
    assert outer["resolved_depth"] == 18.5

    pocket = next(v for v in data["vectors"] if v["semantic"] == "POCKET")
    # У выборки глубина объявлена в слое, её и берём.
    assert pocket["resolved_depth"] == 12.0


def test_api_applies_preset_to_selected_vectors(client, db, imported_part):
    presets = client.get("/api/toolpath-presets").json()
    skip = next(p for p in presets if p["slug"] == "skip")

    targets = [
        v["target"]
        for v in client.get(f"/api/parts/{imported_part.id}/vectors").json()["vectors"]
        if v["semantic"] == "DRILL"
    ]
    response = client.post(
        f"/api/parts/{imported_part.id}/toolpaths",
        json={"targets": targets, "preset_id": skip["id"]},
    )
    assert response.status_code == 200, response.text

    vectors = client.get(f"/api/parts/{imported_part.id}/vectors").json()["vectors"]
    drills = [v for v in vectors if v["semantic"] == "DRILL"]
    assert all(v["preset_name"] == "Не обрабатывать" for v in drills)
    assert all(v["assigned_manually"] for v in drills)
