from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Material, StockItem, StockMovement
from app.schemas import (
    OffcutJudgeOut,
    StockAdjustIn,
    StockConsumeIn,
    StockConsumeResult,
    StockItemOut,
    StockMovementOut,
    StockReceiveIn,
    StockScrapIn,
    StockSummaryRow,
)
from app.stock import service

router = APIRouter(prefix="/stock", tags=["Склад"])


def _decorate(db: Session, items: list[StockItem]) -> list[StockItemOut]:
    if not items:
        return []
    material_ids = {item.material_id for item in items}
    materials = {
        m.id: m for m in db.scalars(select(Material).where(Material.id.in_(material_ids))).all()
    }
    out: list[StockItemOut] = []
    for item in items:
        data = StockItemOut.model_validate(item)
        material = materials.get(item.material_id)
        data.material_name = material.name if material else None
        data.thickness = material.thickness if material else None
        data.area_m2 = item.area_m2
        if item.kind == "offcut":
            data.verdict = service.judge_offcut(item.w, item.h).as_dict()
        out.append(data)
    return out


@router.get("", response_model=list[StockItemOut])
def list_stock(
    db: Session = Depends(get_db),
    material_id: int | None = None,
    kind: str | None = Query(default=None, description="sheet | offcut"),
    include_used: bool = False,
) -> list[StockItemOut]:
    """Остатки склада. Обрезки идут первыми: их расходуют в первую очередь."""
    if include_used:
        stmt = select(StockItem).order_by(StockItem.id.desc())
        if material_id is not None:
            stmt = stmt.where(StockItem.material_id == material_id)
        if kind is not None:
            stmt = stmt.where(StockItem.kind == kind)
        items = list(db.scalars(stmt).all())
    else:
        items = service.available_items(db, material_id=material_id, kind=kind)
    return _decorate(db, items)


@router.get("/summary", response_model=list[StockSummaryRow])
def stock_summary(db: Session = Depends(get_db)) -> list[dict]:
    return service.summary(db)


@router.get("/judge-offcut", response_model=OffcutJudgeOut)
def judge_offcut(w: float = Query(gt=0), h: float = Query(gt=0)) -> dict:
    """Стоит ли хранить обрезок такого размера. Это рекомендация по порогам
    из конфига, решение принимает технолог."""
    return service.judge_offcut(w, h).as_dict()


@router.post("", response_model=StockItemOut, status_code=201)
def receive(payload: StockReceiveIn, db: Session = Depends(get_db)) -> StockItemOut:
    try:
        item = service.receive(db, **payload.model_dump())
    except service.StockError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _decorate(db, [item])[0]


@router.post("/{item_id}/consume", response_model=StockConsumeResult)
def consume(
    item_id: int, payload: StockConsumeIn, db: Session = Depends(get_db)
) -> StockConsumeResult:
    """Отметка «лист отрезан»: списывает лист и кладёт обрезки обратно на склад."""
    try:
        result = service.consume(
            db,
            item_id=item_id,
            qty=payload.qty,
            offcuts=[service.OffcutSpec(**o.model_dump()) for o in payload.offcuts],
            reason=payload.reason,
            actor=payload.actor,
            sheet_id=payload.sheet_id,
        )
    except service.StockError as exc:
        raise HTTPException(400, str(exc)) from exc
    return StockConsumeResult(
        item=_decorate(db, [result["item"]])[0],
        offcuts=_decorate(db, result["offcuts"]),
    )


@router.post("/{item_id}/scrap", response_model=StockItemOut)
def scrap(item_id: int, payload: StockScrapIn, db: Session = Depends(get_db)) -> StockItemOut:
    try:
        item = service.scrap(db, item_id=item_id, **payload.model_dump())
    except service.StockError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _decorate(db, [item])[0]


@router.post("/{item_id}/adjust", response_model=StockItemOut)
def adjust(item_id: int, payload: StockAdjustIn, db: Session = Depends(get_db)) -> StockItemOut:
    try:
        item = service.adjust(db, item_id=item_id, **payload.model_dump())
    except service.StockError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _decorate(db, [item])[0]


@router.get("/{item_id}/movements", response_model=list[StockMovementOut])
def movements(item_id: int, db: Session = Depends(get_db)) -> list[StockMovement]:
    """Журнал по позиции: куда делся лист."""
    if db.get(StockItem, item_id) is None:
        raise HTTPException(404, "Складская позиция не найдена")
    return list(
        db.scalars(
            select(StockMovement)
            .where(StockMovement.item_id == item_id)
            .order_by(StockMovement.id.desc())
        ).all()
    )
