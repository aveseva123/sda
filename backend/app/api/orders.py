"""Заказы и файлы.

CRM-слоя нет: заказ — это просто имя, оно лежит текстом на детали.
Настоящая единица принадлежности — файл DXF: он держит цвет, и именно по
нему технолог опознаёт деталь в цеху.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.colors import FILE_PALETTE, SHEET_PATTERNS, file_color
from app.core.db import get_db
from app.models import ImportFile, Part, PartStatus
from app.schemas import FileOut, FilePatch, OrderOut

router = APIRouter(tags=["Заказы и файлы"])


@router.get("/files", response_model=list[FileOut])
def list_files(db: Session = Depends(get_db)) -> list[FileOut]:
    """Буфер: файлы с их цветом, заказом и количеством деталей."""
    files = list(db.scalars(select(ImportFile).order_by(ImportFile.id)).all())

    stats: dict[int, dict] = {}
    for source_id, count, qty, sheets in db.execute(
        select(
            Part.source_file_id,
            func.count(Part.id),
            func.coalesce(func.sum(Part.qty), 0),
            func.count(func.distinct(Part.source_sheet_index)),
        ).group_by(Part.source_file_id)
    ):
        stats[source_id] = {
            "positions": count,
            "parts": int(qty),
            "sheets": sheets,
        }

    # Разбивка по листам внутри файла — для дерева в буфере.
    by_sheet: dict[int, dict[int, int]] = {}
    for source_id, sheet_index, qty in db.execute(
        select(
            Part.source_file_id,
            Part.source_sheet_index,
            func.coalesce(func.sum(Part.qty), 0),
        ).group_by(Part.source_file_id, Part.source_sheet_index)
    ):
        by_sheet.setdefault(source_id, {})[int(sheet_index or 0)] = int(qty)

    pending: dict[int, int] = {}
    for source_id, count in db.execute(
        select(Part.source_file_id, func.count(Part.id))
        .where(Part.status == PartStatus.NEEDS_CLARIFICATION)
        .group_by(Part.source_file_id)
    ):
        pending[source_id] = count

    out: list[FileOut] = []
    for record in files:
        entry = stats.get(record.id, {})
        out.append(
            FileOut(
                id=record.id,
                filename=record.filename,
                relpath=record.relpath,
                order_name=record.order_name,
                color=record.color,
                color_index=record.color_index,
                status=record.status,
                detected_source=record.detected_source,
                sheets=entry.get("sheets", 0),
                positions=entry.get("positions", 0),
                parts=entry.get("parts", 0),
                sheet_parts=[
                    count
                    for _, count in sorted((by_sheet.get(record.id) or {}).items())
                ],
                needs_clarification=pending.get(record.id, 0),
                error=record.error,
            )
        )
    return out


@router.patch("/files/{file_id}", response_model=FileOut)
def update_file(file_id: int, payload: FilePatch, db: Session = Depends(get_db)) -> FileOut:
    """Правка заказа и цвета файла."""
    record = db.get(ImportFile, file_id)
    if record is None:
        raise HTTPException(404, "Файл не найден")

    data = payload.model_dump(exclude_unset=True)
    if "order_name" in data:
        record.order_name = data["order_name"]
        # Заказ живёт на детали: переименование должно доехать до раскроя.
        for part in db.scalars(
            select(Part).where(Part.source_file_id == record.id)
        ).all():
            part.order_name = data["order_name"]
    if "color_index" in data and data["color_index"] is not None:
        record.color_index = data["color_index"]
        record.color = file_color(data["color_index"])
    db.flush()
    updated = next(item for item in list_files(db) if item.id == record.id)
    return updated


@router.get("/orders", response_model=list[OrderOut])
def list_orders(db: Session = Depends(get_db)) -> list[OrderOut]:
    """Заказы — это просто сгруппированные имена."""
    rows = db.execute(
        select(
            Part.order_name,
            func.count(Part.id),
            func.coalesce(func.sum(Part.qty), 0),
            func.count(func.distinct(Part.source_file_id)),
        ).group_by(Part.order_name)
    ).all()

    pending: dict[str | None, int] = {}
    for name, count in db.execute(
        select(Part.order_name, func.count(Part.id))
        .where(Part.status == PartStatus.NEEDS_CLARIFICATION)
        .group_by(Part.order_name)
    ):
        pending[name] = count

    return [
        OrderOut(
            name=name or "Без заказа",
            positions=positions,
            parts=int(parts),
            files=files,
            needs_clarification=pending.get(name, 0),
        )
        for name, positions, parts, files in sorted(
            rows, key=lambda r: (r[0] is None, r[0] or "")
        )
    ]


@router.get("/palette", response_model=dict)
def palette() -> dict:
    """Палитра файлов и штриховки листов — для легенды и настроек."""
    return {
        "files": list(FILE_PALETTE),
        "sheet_patterns": list(SHEET_PATTERNS),
        "note": (
            "Цвет закреплён за файлом, штриховка — за номером листа внутри "
            "файла. Палитра различима при дальтонизме и в ч/б печати."
        ),
    }
