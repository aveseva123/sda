from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.colors import part_style
from app.core.db import get_db
from app.models import (
    ImportFile,
    Material,
    Part,
    PartInstance,
    PartStatus,
    ResolveSource,
)
from app.schemas import (
    BulkAssign,
    BulkAssignResult,
    PartGeometryOut,
    PartOut,
    PartPatch,
)

router = APIRouter(prefix="/parts", tags=["Детали"])


def _decorate(db: Session, parts: list[Part]) -> list[PartOut]:
    """Дополняет детали тем, что живёт рядом: файлом, цветом, материалом."""
    if not parts:
        return []
    file_ids = {p.source_file_id for p in parts if p.source_file_id}
    files = {
        f.id: f
        for f in db.scalars(select(ImportFile).where(ImportFile.id.in_(file_ids))).all()
    }
    material_ids = {p.material_id for p in parts if p.material_id}
    materials = {
        m.id: m
        for m in db.scalars(select(Material).where(Material.id.in_(material_ids))).all()
    }

    out: list[PartOut] = []
    for part in parts:
        item = PartOut.model_validate(part)
        source = files.get(part.source_file_id) if part.source_file_id else None
        item.source_file = source.filename if source else None
        # Цвет — по файлу, штриховка — по листу внутри файла.
        item.style = part_style(
            source.color if source else "#7D82C5", part.source_sheet_index or 0
        )
        material = materials.get(part.material_id) if part.material_id else None
        item.material_name = material.name if material else None
        out.append(item)
    return out


@router.get("", response_model=list[PartOut])
def list_parts(
    db: Session = Depends(get_db),
    order_name: str | None = None,
    source_file_id: int | None = None,
    material_id: int | None = None,
    thickness: float | None = None,
    status: str | None = Query(default=None, description="ready | needs_clarification"),
    limit: int = Query(default=500, le=5000),
    offset: int = 0,
) -> list[PartOut]:
    stmt = select(Part)
    if order_name is not None:
        stmt = stmt.where(Part.order_name == order_name)
    if source_file_id is not None:
        stmt = stmt.where(Part.source_file_id == source_file_id)
    if material_id is not None:
        stmt = stmt.where(Part.material_id == material_id)
    if thickness is not None:
        stmt = stmt.where(Part.thickness == thickness)
    if status is not None:
        stmt = stmt.where(Part.status == status)
    stmt = stmt.order_by(Part.thickness.nulls_last(), Part.name).limit(limit).offset(offset)
    return _decorate(db, list(db.scalars(stmt).all()))


@router.get("/pending", response_model=list[PartOut])
def list_pending(db: Session = Depends(get_db)) -> list[PartOut]:
    """Очередь «требует уточнения». Детали, для которых система не смогла
    уверенно определить толщину или материал — вместе с трассировкой того,
    что именно она пробовала."""
    stmt = (
        select(Part)
        .where(Part.status == PartStatus.NEEDS_CLARIFICATION)
        .order_by(Part.source_file, Part.name)
    )
    return _decorate(db, list(db.scalars(stmt).all()))


@router.get("/{part_id}/geometry", response_model=PartGeometryOut)
def part_geometry(part_id: int, db: Session = Depends(get_db)) -> PartGeometryOut:
    part = db.get(Part, part_id)
    if part is None:
        raise HTTPException(404, "Деталь не найдена")
    return PartGeometryOut(id=part.id, name=part.name, geometry=part.geometry)


@router.patch("/{part_id}", response_model=PartOut)
def update_part(part_id: int, payload: PartPatch, db: Session = Depends(get_db)) -> PartOut:
    part = db.get(Part, part_id)
    if part is None:
        raise HTTPException(404, "Деталь не найдена")

    data = payload.model_dump(exclude_unset=True)
    if "thickness" in data and data["thickness"] is not None:
        part.thickness_source = ResolveSource.MANUAL
        part.thickness_confidence = 1.0
    if "material_id" in data and data["material_id"] is not None:
        if db.get(Material, data["material_id"]) is None:
            raise HTTPException(400, "Материал не найден")
        part.material_source = ResolveSource.MANUAL
    if "qty" in data and data["qty"] is not None:
        _sync_instances(db, part, data["qty"])

    for key, value in data.items():
        setattr(part, key, value)

    _refresh_status(part)
    db.flush()
    return _decorate(db, [part])[0]


@router.post("/bulk-assign", response_model=BulkAssignResult)
def bulk_assign(payload: BulkAssign, db: Session = Depends(get_db)) -> BulkAssignResult:
    """Массовое назначение толщины/материала мультивыбором — так технолог
    разбирает очередь уточнений, не открывая каждую деталь."""
    parts = list(db.scalars(select(Part).where(Part.id.in_(payload.part_ids))).all())
    if not parts:
        raise HTTPException(404, "Детали не найдены")

    if payload.material_id is not None and db.get(Material, payload.material_id) is None:
        raise HTTPException(400, "Материал не найден")
    resolved = 0
    for part in parts:
        if payload.thickness is not None:
            part.thickness = payload.thickness
            part.thickness_source = ResolveSource.MANUAL
            part.thickness_confidence = 1.0
        if payload.material_id is not None:
            part.material_id = payload.material_id
            part.material_source = ResolveSource.MANUAL
        if payload.order_name is not None:
            part.order_name = payload.order_name
        _refresh_status(part)
        if part.status == PartStatus.READY:
            resolved += 1

    db.flush()
    pending_count = db.scalar(
        select(func.count())
        .select_from(Part)
        .where(Part.status == PartStatus.NEEDS_CLARIFICATION)
    ) or 0

    return BulkAssignResult(
        updated=len(parts), resolved=resolved, still_pending=pending_count
    )


def _refresh_status(part: Part) -> None:
    """Деталь готова, когда известны и толщина, и материал: раскрой идёт
    по паре «материал + толщина»."""
    if part.thickness is not None and part.material_id is not None:
        part.status = PartStatus.READY
        part.clarification = None
    else:
        part.status = PartStatus.NEEDS_CLARIFICATION


def _sync_instances(db: Session, part: Part, qty: int) -> None:
    instances = list(
        db.scalars(
            select(PartInstance).where(PartInstance.part_id == part.id).order_by(PartInstance.id)
        ).all()
    )
    if qty > len(instances):
        for i in range(len(instances), qty):
            db.add(
                PartInstance(
                    part_id=part.id,
                    uid=f"P{part.product_id:04d}-D{part.id:06d}-{i + 1:03d}",
                )
            )
    else:
        # Лишние экземпляры удаляются только пока они не разложены на листе.
        for instance in instances[qty:]:
            if instance.sheet_id is None:
                db.delete(instance)
    db.flush()
