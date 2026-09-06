"""Пресеты раскроя.

Технолог настраивает раскрой материала один раз — дальше пресет
подбирается сам по паре «материал + толщина». Правки через интерфейс
снимают признак «встроенный»: такой пресет больше не перезаписывается
из конфига.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.cutting import service
from app.models import CuttingPreset, Material
from app.schemas import CuttingPresetIn, CuttingPresetOut

router = APIRouter(tags=["Пресеты раскроя"])


@router.get("/cutting-presets", response_model=list[CuttingPresetOut])
def list_presets(db: Session = Depends(get_db)) -> list[CuttingPreset]:
    """Библиотека пресетов. При первом обращении наполняется из
    config/cutting_presets.yaml."""
    return service.all_presets(db)


@router.get("/cutting-presets/match", response_model=CuttingPresetOut | None)
def match_preset(
    material_id: int = Query(description="материал"),
    thickness: float = Query(gt=0, description="толщина, мм"),
    db: Session = Depends(get_db),
) -> CuttingPreset | None:
    """Какой пресет платформа подберёт этой паре «материал + толщина».

    Пустой ответ — не ошибка, а честное «подходящего пресета нет»:
    раскрой 16 мм пресетом на 18 прорезал бы жертвенный стол.
    """
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Материал не найден")
    return service.preset_for(db, material=material, thickness=thickness)


@router.post("/cutting-presets", response_model=CuttingPresetOut, status_code=201)
def create_preset(payload: CuttingPresetIn, db: Session = Depends(get_db)) -> CuttingPreset:
    if db.scalar(select(CuttingPreset).where(CuttingPreset.slug == payload.slug)):
        raise HTTPException(409, f"Пресет «{payload.slug}» уже существует")
    preset = CuttingPreset(**payload.model_dump(), is_builtin=False)
    db.add(preset)
    db.flush()
    _keep_single_default(db, preset)
    return preset


@router.put("/cutting-presets/{preset_id}", response_model=CuttingPresetOut)
def update_preset(
    preset_id: int, payload: CuttingPresetIn, db: Session = Depends(get_db)
) -> CuttingPreset:
    preset = db.get(CuttingPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "Пресет не найден")
    for key, value in payload.model_dump().items():
        setattr(preset, key, value)
    # Пресет, поправленный технологом, конфиг больше не перезаписывает.
    preset.is_builtin = False
    db.flush()
    _keep_single_default(db, preset)
    return preset


@router.delete("/cutting-presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Session = Depends(get_db)) -> None:
    preset = db.get(CuttingPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "Пресет не найден")
    db.delete(preset)
    db.flush()


def _keep_single_default(db: Session, preset: CuttingPreset) -> None:
    """Пресет по умолчанию всегда один — иначе подбор становится лотереей."""
    if not preset.is_default:
        return
    for other in db.scalars(
        select(CuttingPreset).where(
            CuttingPreset.is_default.is_(True), CuttingPreset.id != preset.id
        )
    ).all():
        other.is_default = False
    db.flush()
