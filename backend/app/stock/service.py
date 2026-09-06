"""Операции склада.

Главный сценарий заказчика:

    отрезал лист -> отметил, что отрезал -> лист списался со склада
                 -> обрезок, если он крупный, остался как деловой отход
                 -> обрезок можно пустить в раскрой следующим заданием

Решение «крупный или нет» платформа не принимает за технолога: она считает
порог из конфига и ПРЕДЛАГАЕТ, а отметку ставит человек. Пороги в
``config/app.yaml`` -> ``stock.offcut``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config_files import app_config
from app.models import (
    Material,
    StockItem,
    StockKind,
    StockMovement,
    StockMovementKind,
    StockStatus,
)


class StockError(RuntimeError):
    """Складская операция невозможна: нет позиции, не хватает остатка и т.п."""


def offcut_thresholds() -> dict:
    return (app_config().get("stock", {}) or {}).get("offcut", {}) or {}


@dataclass(slots=True)
class OffcutSpec:
    """Обрезок, который технолог решил оставить."""

    w: float
    h: float
    note: str | None = None
    location: str | None = None


@dataclass(slots=True)
class OffcutVerdict:
    """Стоит ли хранить обрезок такого размера."""

    worth_keeping: bool
    reason: str
    area_m2: float
    thresholds: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "worth_keeping": self.worth_keeping,
            "reason": self.reason,
            "area_m2": self.area_m2,
            "thresholds": self.thresholds,
        }


def judge_offcut(w: float, h: float) -> OffcutVerdict:
    """Рекомендация по обрезку. Именно рекомендация: последнее слово за
    технологом, он может сохранить и мелкий кусок, и выбросить крупный."""
    cfg = offcut_thresholds()
    min_short = float(cfg.get("min_width", 100))
    min_long = float(cfg.get("min_length", 300))
    min_area = float(cfg.get("min_area_m2", 0.10))

    short, long = min(w, h), max(w, h)
    area = round(w * h / 1_000_000, 4)
    thresholds = {"min_width": min_short, "min_length": min_long, "min_area_m2": min_area}

    if short < min_short:
        return OffcutVerdict(
            False, f"короткая сторона {short:.0f} мм меньше порога {min_short:.0f} мм",
            area, thresholds,
        )
    if long < min_long:
        return OffcutVerdict(
            False, f"длинная сторона {long:.0f} мм меньше порога {min_long:.0f} мм",
            area, thresholds,
        )
    if area < min_area:
        return OffcutVerdict(
            False, f"площадь {area:.3f} м² меньше порога {min_area:.2f} м²",
            area, thresholds,
        )
    return OffcutVerdict(True, f"{long:.0f} × {short:.0f} мм, {area:.3f} м²", area, thresholds)


def receive(
    db: Session,
    *,
    material_id: int,
    w: float,
    h: float,
    qty: int = 1,
    kind: str = StockKind.SHEET,
    location: str | None = None,
    note: str | None = None,
    price: float | None = None,
    actor: str | None = None,
) -> StockItem:
    """Приход на склад."""
    if qty < 1:
        raise StockError("Количество должно быть не меньше одного")
    if w <= 0 or h <= 0:
        raise StockError("Габариты листа должны быть положительными")
    if db.get(Material, material_id) is None:
        raise StockError("Материал не найден")

    item = StockItem(
        material_id=material_id,
        kind=kind,
        w=float(w),
        h=float(h),
        qty=int(qty),
        status=StockStatus.AVAILABLE,
        location=location,
        note=note,
        price=price,
    )
    db.add(item)
    db.flush()
    _log(db, item, StockMovementKind.RECEIPT, qty, "приход на склад", actor)
    return item


def consume(
    db: Session,
    *,
    item_id: int,
    qty: int = 1,
    offcuts: list[OffcutSpec] | None = None,
    reason: str | None = None,
    actor: str | None = None,
    sheet_id: int | None = None,
) -> dict:
    """Лист отрезан: списывается со склада, обрезки ложатся обратно.

    Возвращает списанную позицию и созданные обрезки.
    """
    item = db.get(StockItem, item_id)
    if item is None:
        raise StockError("Складская позиция не найдена")
    if item.status == StockStatus.USED:
        raise StockError("Позиция уже израсходована")
    if qty < 1:
        raise StockError("Количество должно быть не меньше одного")
    if qty > item.qty:
        raise StockError(
            f"На складе {item.qty} шт., списать {qty} нельзя"
        )

    item.qty -= qty
    if item.qty == 0:
        item.status = StockStatus.USED
    db.flush()
    _log(
        db,
        item,
        StockMovementKind.CONSUME,
        -qty,
        reason or "лист отрезан",
        actor,
    )

    created: list[StockItem] = []
    for spec in offcuts or []:
        if spec.w <= 0 or spec.h <= 0:
            raise StockError("Габариты обрезка должны быть положительными")
        if spec.w > max(item.w, item.h) + 1e-6 or spec.h > max(item.w, item.h) + 1e-6:
            raise StockError(
                f"Обрезок {spec.w:.0f}×{spec.h:.0f} не помещается в лист "
                f"{item.w:.0f}×{item.h:.0f}"
            )
        offcut = StockItem(
            material_id=item.material_id,
            kind=StockKind.OFFCUT,
            w=float(spec.w),
            h=float(spec.h),
            qty=1,
            status=StockStatus.AVAILABLE,
            location=spec.location or item.location,
            note=spec.note,
            source_item_id=item.id,
            source_sheet_id=sheet_id,
        )
        db.add(offcut)
        db.flush()
        _log(
            db,
            offcut,
            StockMovementKind.OFFCUT,
            1,
            f"деловой отход от позиции №{item.id}",
            actor,
            offcut_id=offcut.id,
        )
        created.append(offcut)

    return {"item": item, "offcuts": created}


def scrap(
    db: Session, *, item_id: int, qty: int = 1, reason: str | None = None,
    actor: str | None = None,
) -> StockItem:
    """Списание в мусор: обрезок оказался слишком мелким."""
    item = db.get(StockItem, item_id)
    if item is None:
        raise StockError("Складская позиция не найдена")
    if qty > item.qty:
        raise StockError(f"На складе {item.qty} шт., списать {qty} нельзя")

    item.qty -= qty
    if item.qty == 0:
        item.status = StockStatus.SCRAPPED
    db.flush()
    _log(db, item, StockMovementKind.SCRAP, -qty, reason or "списан в мусор", actor)
    return item


def adjust(
    db: Session, *, item_id: int, new_qty: int, reason: str | None = None,
    actor: str | None = None,
) -> StockItem:
    """Ручная корректировка остатка после инвентаризации."""
    item = db.get(StockItem, item_id)
    if item is None:
        raise StockError("Складская позиция не найдена")
    if new_qty < 0:
        raise StockError("Остаток не может быть отрицательным")

    delta = new_qty - item.qty
    item.qty = new_qty
    item.status = StockStatus.AVAILABLE if new_qty > 0 else StockStatus.USED
    db.flush()
    if delta:
        _log(db, item, StockMovementKind.ADJUST, delta, reason or "инвентаризация", actor)
    return item


def available_items(
    db: Session, *, material_id: int | None = None, kind: str | None = None
) -> list[StockItem]:
    stmt = select(StockItem).where(
        StockItem.status == StockStatus.AVAILABLE, StockItem.qty > 0
    )
    if material_id is not None:
        stmt = stmt.where(StockItem.material_id == material_id)
    if kind is not None:
        stmt = stmt.where(StockItem.kind == kind)
    # Обрезки — вперёд: их надо расходовать в первую очередь, иначе склад
    # зарастает деловым отходом, который никто не берёт.
    # kind по возрастанию: "offcut" < "sheet".
    return list(
        db.scalars(
            stmt.order_by(
                StockItem.kind.asc(),
                (StockItem.w * StockItem.h).asc(),
                StockItem.id.asc(),
            )
        ).all()
    )


def summary(db: Session) -> list[dict]:
    """Остатки по материалам: сколько целых листов, сколько обрезков, площадь."""
    rows = db.execute(
        select(
            StockItem.material_id,
            StockItem.kind,
            func.sum(StockItem.qty),
            func.sum(StockItem.qty * StockItem.w * StockItem.h),
        )
        .where(StockItem.status == StockStatus.AVAILABLE, StockItem.qty > 0)
        .group_by(StockItem.material_id, StockItem.kind)
    ).all()

    materials = {m.id: m for m in db.scalars(select(Material)).all()}
    merged: dict[int, dict] = {}
    for material_id, kind, qty, area in rows:
        material = materials.get(material_id)
        entry = merged.setdefault(
            material_id,
            {
                "material_id": material_id,
                "material_name": material.name if material else "—",
                "thickness": material.thickness if material else None,
                "sheets": 0,
                "offcuts": 0,
                "area_m2": 0.0,
            },
        )
        if kind == StockKind.OFFCUT:
            entry["offcuts"] += int(qty or 0)
        else:
            entry["sheets"] += int(qty or 0)
        entry["area_m2"] = round(entry["area_m2"] + float(area or 0) / 1_000_000, 3)

    return sorted(merged.values(), key=lambda e: (e["thickness"] or 0, e["material_name"]))


def _log(
    db: Session,
    item: StockItem,
    kind: str,
    qty: int,
    reason: str,
    actor: str | None,
    offcut_id: int | None = None,
) -> None:
    db.add(
        StockMovement(
            item_id=item.id,
            kind=kind,
            qty=qty,
            reason=reason,
            actor=actor,
            offcut_id=offcut_id,
        )
    )
    db.flush()
