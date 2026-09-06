"""Тесты API Этапа 1: загрузка → мастер слоёв → разбор → дерево → уточнения."""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

import tests.factories as factories
from app.core.db import get_db
from app.main import app


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def dxf_18(tmp_path) -> bytes:
    path = tmp_path / "b18.dxf"
    factories.bazis_part(path, width=600, height=400, thickness=18.0)
    return path.read_bytes()


@pytest.fixture
def dxf_15(tmp_path) -> bytes:
    path = tmp_path / "b15.dxf"
    factories.bazis_part(path, width=800, height=300, thickness=15.0)
    return path.read_bytes()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_materials_crud(client, db):
    created = client.post(
        "/api/materials",
        json={"name": "ЛДСП Белый", "thickness": 18.0, "aliases": ["белый"]},
    )
    assert created.status_code == 201, created.text
    assert client.get("/api/materials/thicknesses").json() == [18.0]

    duplicate = client.post("/api/materials", json={"name": "ЛДСП Белый", "thickness": 18.0})
    assert duplicate.status_code == 409


def test_full_import_flow(client, materials, dxf_18, dxf_15):
    upload = client.post(
        "/api/imports",
        files=[
            ("files", ("Bok_18.dxf", dxf_18, "application/dxf")),
            ("files", ("Polka_15.dxf", dxf_15, "application/dxf")),
        ],
        data={"name": "Тестовая пачка"},
    )
    assert upload.status_code == 201, upload.text
    batch = upload.json()
    assert len(batch["files"]) == 2
    assert batch["detected_source"] == "bazis"

    layers = client.get(f"/api/imports/{batch['id']}/layers").json()
    names = {layer["name"] for layer in layers["layers"]}
    assert {"BOARDS", "PERIMETER D 18.00", "HOLES DIAM 8.00 D 18.00"} <= names
    # Мастер предлагает семантику по геометрии, а не по зашитым именам.
    assert layers["suggestions"]["HOLES DIAM 8.00 D 18.00"] == "DRILL"
    assert layers["suggestions"]["BOARDS"] == "SHEET"

    preview = client.get(
        f"/api/imports/{batch['id']}/layers/HOLES DIAM 8.00 D 18.00/preview"
    ).json()
    assert len(preview["paths"]) == 3, "в превью должны попасть три окружности присадки"

    processed = client.post(f"/api/imports/{batch['id']}/process", json={}).json()
    assert processed["stats"]["parsed"] == 2, processed["stats"]

    files = client.get("/api/files").json()
    assert len(files) == 2, "буфер показывает загруженные файлы"
    assert all(f["color"].startswith("#") for f in files), "цвет закреплён за файлом"
    assert sum(f["positions"] for f in files) == 2

    orders = client.get("/api/orders").json()
    assert orders, "заказ — просто имя, сгруппированное по деталям"

    parts = client.get("/api/parts").json()
    assert sorted(p["thickness"] for p in parts) == [15.0, 18.0]
    assert all(p["thickness_source"] == "layer_depth" for p in parts)
    assert all(p["style"]["fill"].startswith("#") for p in parts)

    sheets = client.get(f"/api/imports/{batch['id']}/sheets").json()
    assert sheets and sheets[0]["w"] == 2800.0 and sheets[0]["h"] == 2070.0

    geometry = client.get(f"/api/parts/{parts[0]['id']}/geometry").json()
    assert geometry["geometry"]["outer"], "геометрия должна сохраниться для карты раскроя"


def test_clarification_queue_and_bulk_assign(client, materials, tmp_path):
    # Две РАЗНЫЕ детали: одинаковые схлопнулись бы дедупликацией в одну
    # позицию (это проверяется отдельно в test_import_pipeline).
    first = tmp_path / "a.dxf"
    second = tmp_path / "b.dxf"
    factories.fusion_part(first, width=800, height=300)
    factories.fusion_part(second, width=500, height=250)

    upload = client.post(
        "/api/imports",
        files=[
            ("files", ("детальА.dxf", first.read_bytes(), "application/dxf")),
            ("files", ("детальБ.dxf", second.read_bytes(), "application/dxf")),
        ],
    ).json()
    client.post(f"/api/imports/{upload['id']}/process", json={})

    pending = client.get("/api/parts/pending").json()
    assert len(pending) == 2, "толщину неоткуда взять — обе детали в очереди"
    assert pending[0]["clarification"]["thickness"]["attempts"]

    material_id = materials[0].id
    result = client.post(
        "/api/parts/bulk-assign",
        json={
            "part_ids": [p["id"] for p in pending],
            "thickness": 18.0,
            "material_id": material_id,
        },
    ).json()
    assert result == {"updated": 2, "resolved": 2, "still_pending": 0}
    assert client.get("/api/parts/pending").json() == []

    parts = client.get("/api/parts").json()
    assert all(p["thickness_source"] == "manual" for p in parts)


def test_layer_preset_is_saved_and_reused(client, materials, dxf_18):
    saved = client.post(
        "/api/layer-presets",
        json={
            "name": "Мой Базис",
            "source": "bazis",
            "rules": [
                {"layer": "BOARDS", "semantic": "SHEET"},
                {"layer": "PERIMETER D 18.00", "semantic": "OUTER"},
                {"layer": "HOLES DIAM 8.00 D 18.00", "semantic": "DRILL"},
                {"layer": "INSETS D 12.00", "semantic": "POCKET"},
            ],
            "thickness_from_layer_regex": None,
        },
    )
    assert saved.status_code == 201, saved.text
    preset_id = saved.json()["id"]

    upload = client.post(
        "/api/imports", files=[("files", ("Bok_18.dxf", dxf_18, "application/dxf"))]
    ).json()
    processed = client.post(
        f"/api/imports/{upload['id']}/process", json={"layer_preset_id": preset_id}
    ).json()
    assert processed["stats"]["parsed"] == 1
    assert processed["layer_preset_id"] == preset_id


def test_zip_with_folders_keeps_thickness_from_folder(client, materials, tmp_path):
    # Источник без глубины в слоях: иначе выиграл бы он, а не имя папки.
    path = tmp_path / "plain.dxf"
    factories.fusion_part(path)
    plain = path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("18mm/Bok.dxf", plain)
        archive.writestr("15mm/Polka.dxf", plain)

    upload = client.post(
        "/api/imports",
        files=[("files", ("pack.zip", buffer.getvalue(), "application/zip"))],
    ).json()
    client.post(f"/api/imports/{upload['id']}/process", json={})

    parts = client.get("/api/parts").json()
    assert sorted(p["thickness"] for p in parts) == [15.0, 18.0]
    assert all(p["thickness_source"] == "folder" for p in parts)


def test_config_endpoint_exposes_editable_settings(client):
    config = client.get("/api/config").json()
    assert config["thicknesses"]["known"], "список толщин расширяемый и приходит из конфига"
    assert config["labels"]["default_template"] == "roll_120x75"
    assert any(t["name"] == "fusion_full" for t in config["filename_templates"])
