"""Тесты склада: приход, списание отрезанного листа, деловой отход."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_db
from app.main import app
from app.models import StockItem, StockKind, StockMovement, StockStatus
from app.stock import service


@pytest.fixture
def client(db, tmp_storage):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ------------------------------------------------------- порог обрезка


@pytest.mark.parametrize(
    ("w", "h", "keep"),
    [
        (2070, 380, True),    # полноценная полоса — хранить
        (2070, 80, False),    # узкая планка, короткая сторона меньше порога
        (400, 150, False),    # площадь 0.06 м² — меньше порога
        (900, 1200, True),
        (250, 600, True),
    ],
)
def test_offcut_threshold(w, h, keep):
    """Порог — рекомендация. Ниже него обрезок предлагается выбросить."""
    verdict = service.judge_offcut(w, h)
    assert verdict.worth_keeping is keep
    assert verdict.reason


# ------------------------------------------------------------- сервис


def test_receive_puts_sheets_on_stock(db, materials):
    item = service.receive(
        db, material_id=materials[0].id, w=2800, h=2070, qty=12, location="Стеллаж А"
    )
    assert item.qty == 12
    assert item.status == StockStatus.AVAILABLE
    assert item.kind == StockKind.SHEET

    movement = db.scalar(select(StockMovement))
    assert movement.kind == "receipt" and movement.qty == 12


def test_cut_sheet_removes_it_and_keeps_the_offcut(db, materials):
    """Главный сценарий: отрезал лист -> лист списался -> обрезок остался."""
    item = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=3)

    result = service.consume(
        db,
        item_id=item.id,
        qty=1,
        offcuts=[service.OffcutSpec(w=2070, h=420, note="от бока шкафа")],
        actor="Технолог",
    )

    assert result["item"].qty == 2, "лист списался со склада"
    assert result["item"].status == StockStatus.AVAILABLE

    offcut = result["offcuts"][0]
    assert offcut.kind == StockKind.OFFCUT
    assert (offcut.w, offcut.h) == (2070.0, 420.0)
    assert offcut.source_item_id == item.id
    assert offcut.status == StockStatus.AVAILABLE

    kinds = [m.kind for m in db.scalars(select(StockMovement)).all()]
    assert kinds == ["receipt", "consume", "offcut"], "движения пишутся в журнал"


def test_last_sheet_leaves_the_stock(db, materials):
    item = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=1)
    service.consume(db, item_id=item.id, qty=1)

    refreshed = db.get(StockItem, item.id)
    assert refreshed.qty == 0
    assert refreshed.status == StockStatus.USED
    assert service.available_items(db) == []


def test_offcut_can_be_cut_again(db, materials):
    """От обрезка тоже остаётся обрезок — цикл должен замыкаться."""
    sheet = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=1)
    first = service.consume(
        db, item_id=sheet.id, offcuts=[service.OffcutSpec(w=2070, h=900)]
    )["offcuts"][0]

    second = service.consume(
        db, item_id=first.id, offcuts=[service.OffcutSpec(w=900, h=800)]
    )["offcuts"][0]

    assert second.kind == StockKind.OFFCUT
    assert second.source_item_id == first.id
    assert db.get(StockItem, first.id).status == StockStatus.USED


def test_cannot_consume_more_than_available(db, materials):
    item = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=2)
    with pytest.raises(service.StockError, match="списать 5 нельзя"):
        service.consume(db, item_id=item.id, qty=5)


def test_offcut_cannot_be_bigger_than_the_sheet(db, materials):
    """Защита от опечатки: обрезок 3000 мм из листа 2800 мм невозможен."""
    item = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=1)
    with pytest.raises(service.StockError, match="не помещается"):
        service.consume(db, item_id=item.id, offcuts=[service.OffcutSpec(w=3000, h=500)])


def test_offcuts_are_offered_first(db, materials):
    """Обрезки расходуются раньше целых листов, иначе склад ими зарастает."""
    service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=5)
    service.receive(
        db, material_id=materials[0].id, w=1200, h=600, qty=1, kind=StockKind.OFFCUT
    )

    order = [item.kind for item in service.available_items(db)]
    assert order[0] == StockKind.SHEET or order[0] == StockKind.OFFCUT
    assert set(order) == {StockKind.SHEET, StockKind.OFFCUT}
    # Обрезок должен идти раньше целого листа.
    assert order.index(StockKind.OFFCUT) < order.index(StockKind.SHEET)


def test_scrap_removes_small_offcut(db, materials):
    item = service.receive(
        db, material_id=materials[0].id, w=300, h=90, qty=1, kind=StockKind.OFFCUT
    )
    service.scrap(db, item_id=item.id, reason="слишком узкий")

    assert db.get(StockItem, item.id).status == StockStatus.SCRAPPED
    kinds = [m.kind for m in db.scalars(select(StockMovement)).all()]
    assert "scrap" in kinds


def test_inventory_adjustment_is_logged(db, materials):
    item = service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=10)
    service.adjust(db, item_id=item.id, new_qty=7, reason="инвентаризация")

    assert db.get(StockItem, item.id).qty == 7
    movement = db.scalars(select(StockMovement)).all()[-1]
    assert movement.kind == "adjust" and movement.qty == -3


def test_summary_counts_sheets_and_offcuts_separately(db, materials):
    service.receive(db, material_id=materials[0].id, w=2800, h=2070, qty=4)
    service.receive(
        db, material_id=materials[0].id, w=1200, h=600, qty=1, kind=StockKind.OFFCUT
    )

    row = service.summary(db)[0]
    assert row["sheets"] == 4
    assert row["offcuts"] == 1
    assert row["area_m2"] == pytest.approx(4 * 2.8 * 2.07 + 1.2 * 0.6, rel=1e-3)


# --------------------------------------------------------------- API


def test_stock_api_full_cycle(client, materials):
    material_id = materials[0].id

    created = client.post(
        "/api/stock",
        json={"material_id": material_id, "w": 2800, "h": 2070, "qty": 3},
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    verdict = client.get("/api/stock/judge-offcut", params={"w": 2070, "h": 420}).json()
    assert verdict["worth_keeping"] is True

    consumed = client.post(
        f"/api/stock/{item_id}/consume",
        json={"qty": 1, "offcuts": [{"w": 2070, "h": 420, "note": "остаток"}]},
    ).json()
    assert consumed["item"]["qty"] == 2
    assert consumed["offcuts"][0]["kind"] == "offcut"
    assert consumed["offcuts"][0]["verdict"]["worth_keeping"] is True

    stock = client.get("/api/stock").json()
    assert {row["kind"] for row in stock} == {"sheet", "offcut"}

    summary = client.get("/api/stock/summary").json()
    assert summary[0]["sheets"] == 2 and summary[0]["offcuts"] == 1

    movements = client.get(f"/api/stock/{item_id}/movements").json()
    assert [m["kind"] for m in movements] == ["consume", "receipt"]


def test_stock_api_rejects_impossible_offcut(client, materials):
    created = client.post(
        "/api/stock",
        json={"material_id": materials[0].id, "w": 2800, "h": 2070, "qty": 1},
    ).json()
    response = client.post(
        f"/api/stock/{created['id']}/consume",
        json={"offcuts": [{"w": 5000, "h": 500}]},
    )
    assert response.status_code == 400
    assert "не помещается" in response.json()["detail"]


def test_sheet_formats_are_managed_in_the_platform(client, materials):
    """Размеры листа задаются в платформе, а не зашиты в код."""
    material_id = materials[0].id
    added = client.post(
        f"/api/materials/{material_id}/formats", json={"w": 2440, "h": 1220}
    )
    assert added.status_code == 201, added.text

    duplicate = client.post(
        f"/api/materials/{material_id}/formats", json={"w": 2440, "h": 1220}
    )
    assert duplicate.status_code == 409

    formats = client.get(f"/api/materials/{material_id}/formats").json()
    assert [(f["w"], f["h"]) for f in formats] == [(2440.0, 1220.0)]

    client.delete(f"/api/materials/{material_id}/formats/{added.json()['id']}")
    assert client.get(f"/api/materials/{material_id}/formats").json() == []
