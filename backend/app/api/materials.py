from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Material
from app.schemas import MaterialIn, MaterialOut

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
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Материал не найден")
    db.delete(material)


@router.get("/thicknesses", response_model=list[float])
def list_thicknesses(db: Session = Depends(get_db)) -> list[float]:
    """Толщины, реально доступные в справочнике. Список расширяемый:
    появляется новый материал — появляется новая толщина."""
    return sorted({m.thickness for m in db.scalars(select(Material)).all()})
