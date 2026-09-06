from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.colors import product_style
from app.core.db import get_db
from app.models import (
    Material,
    Part,
    PartInstance,
    PartStatus,
    Product,
    Project,
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
    if not parts:
        return []
    product_ids = {p.product_id for p in parts}
    products = {
        p.id: p for p in db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    }
    project_ids = {p.project_id for p in products.values()}
    projects = {
        p.id: p for p in db.scalars(select(Project).where(Project.id.in_(project_ids))).all()
    }
    material_ids = {p.material_id for p in parts if p.material_id}
    materials = {
        m.id: m
        for m in db.scalars(select(Material).where(Material.id.in_(material_ids))).all()
    }

    out: list[PartOut] = []
    for part in parts:
        item = PartOut.model_validate(part)
        product = products.get(part.product_id)
        if product is not None:
            item.product_name = product.name
            project = projects.get(product.project_id)
            if project is not None:
                item.project_id = project.id
                item.project_name = project.name
                item.style = product_style(project.color, product.shade_index)
        material = materials.get(part.material_id) if part.material_id else None
        item.material_name = material.name if material else None
        out.append(item)
    return out


@router.get("", response_model=list[PartOut])
def list_parts(
    db: Session = Depends(get_db),
    project_id: int | None = None,
    product_id: int | None = None,
    material_id: int | None = None,
    thickness: float | None = None,
    status: str | None = Query(default=None, description="ready | needs_clarification"),
    limit: int = Query(default=500, le=5000),
    offset: int = 0,
) -> list[PartOut]:
    stmt = select(Part).join(Product, Product.id == Part.product_id)
    if project_id is not None:
        stmt = stmt.where(Product.project_id == project_id)
    if product_id is not None:
        stmt = stmt.where(Part.product_id == product_id)
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
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise HTTPException(400, "Изделие не найдено")

    resolved = 0
    for part in parts:
        if payload.thickness is not None:
            part.thickness = payload.thickness
            part.thickness_source = ResolveSource.MANUAL
            part.thickness_confidence = 1.0
        if payload.material_id is not None:
            part.material_id = payload.material_id
            part.material_source = ResolveSource.MANUAL
        if payload.product_id is not None:
            part.product_id = payload.product_id
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
