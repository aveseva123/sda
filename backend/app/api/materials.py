from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Material, MaterialSheetFormat, Part, StockItem
from app.schemas import MaterialIn, MaterialOut, SheetFormatIn, SheetFormatOut

router = APIRouter(prefix="/materials", tags=["Материалы"])


@router.get("", response_model=list[MaterialOut])
def list_materials(db: Session = Depends(get_db)) -> list[Material]:
    return list(db.scalars(select(Material).order_by(Material.thickness, Material.name)).all())


@router.post("", response_model=MaterialOut, status_code=201)
def create_material(payload: MaterialIn, db: Session = Depends(get_db)) -> Material:
    exists = db.scalar(
        select(Material).where(
            Material.name == payload.name, Material.thickness == payload.thickness
        )
    )
    if exists is not None:
        raise HTTPException(409, f"Материал «{payload.name}» {payload.thickness} мм уже есть")
    material = Material(**payload.model_dump())
    db.add(material)
    db.flush()
    return material


@router.put("/{material_id}", response_model=MaterialOut)
def update_material(
    material_id: int, payload: MaterialIn, db: Session = Depends(get_db)
) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Материал не найден")
    for key, value in payload.model_dump().items():
        setattr(material, key, value)
    db.flush()
    return material


@router.delete("/{material_id}", status_code=204)
def delete_material(material_id: int, db: Session = Depends(get_db)) -> None:
    """Удаление материала.

    За материалом тянутся склад и журнал движений — база удалит их каскадом,
    молча и без возврата. Поэтому материал, на котором что-то висит, не
    удаляется: сначала спишите остатки и разберитесь с деталями.
    """
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Материал не найден")

    stock = db.scalar(
        select(func.count()).select_from(StockItem).where(
            StockItem.material_id == material_id
        )
    )
    parts = db.scalar(
        select(func.count()).select_from(Part).where(Part.material_id == material_id)
    )
    if stock or parts:
        raise HTTPException(
            409,
            f"«{material.name}» {material.thickness:g} мм удалить нельзя: "
            f"на складе позиций — {stock or 0}, деталей с этим материалом — "
            f"{parts or 0}. Вместе с материалом исчезли бы склад и журнал "
            "движений.",
        )

    db.delete(material)
    db.flush()


@router.get("/thicknesses", response_model=list[float])
def list_thicknesses(db: Session = Depends(get_db)) -> list[float]:
    """Толщины, реально доступные в справочнике. Список расширяемый:
    появляется новый материал — появляется новая толщина."""
    return sorted({m.thickness for m in db.scalars(select(Material)).all()})


@router.get("/{material_id}/formats", response_model=list[SheetFormatOut])
def list_formats(material_id: int, db: Session = Depends(get_db)) -> list[MaterialSheetFormat]:
    """Дополнительные типоразмеры листа. Основной формат хранится в самом
    материале, здесь — остальные, которыми цех реально пользуется."""
    if db.get(Material, material_id) is None:
        raise HTTPException(404, "Материал не найден")
    return list(
        db.scalars(
            select(MaterialSheetFormat)
            .where(MaterialSheetFormat.material_id == material_id)
            .order_by(MaterialSheetFormat.w.desc())
        ).all()
    )


@router.post("/{material_id}/formats", response_model=SheetFormatOut, status_code=201)
def add_format(
    material_id: int, payload: SheetFormatIn, db: Session = Depends(get_db)
) -> MaterialSheetFormat:
    if db.get(Material, material_id) is None:
        raise HTTPException(404, "Материал не найден")
    exists = db.scalar(
        select(MaterialSheetFormat).where(
            MaterialSheetFormat.material_id == material_id,
            MaterialSheetFormat.w == payload.w,
            MaterialSheetFormat.h == payload.h,
        )
    )
    if exists is not None:
        raise HTTPException(409, f"Формат {payload.w:.0f}×{payload.h:.0f} уже заведён")
    fmt = MaterialSheetFormat(material_id=material_id, **payload.model_dump())
    db.add(fmt)
    db.flush()
    return fmt


@router.delete("/{material_id}/formats/{format_id}", status_code=204)
def delete_format(material_id: int, format_id: int, db: Session = Depends(get_db)) -> None:
    fmt = db.get(MaterialSheetFormat, format_id)
    if fmt is None or fmt.material_id != material_id:
        raise HTTPException(404, "Формат не найден")
    db.delete(fmt)
    db.flush()
