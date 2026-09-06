from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Part, PartToolpath, ToolpathPreset
from app.schemas import (
    PartVectorsOut,
    ToolpathAssignIn,
    ToolpathAssignmentOut,
    ToolpathPresetIn,
    ToolpathPresetOut,
)
from app.toolpath import service

router = APIRouter(tags=["Траектории"])


@router.get("/toolpath-presets", response_model=list[ToolpathPresetOut])
def list_presets(db: Session = Depends(get_db)) -> list[ToolpathPreset]:
    """Библиотека стратегий обработки. При первом обращении наполняется
    из config/toolpath_presets.yaml."""
    service.sync_presets(db)
    return list(
        db.scalars(select(ToolpathPreset).order_by(ToolpathPreset.id)).all()
    )


@router.post("/toolpath-presets", response_model=ToolpathPresetOut, status_code=201)
def create_preset(payload: ToolpathPresetIn, db: Session = Depends(get_db)) -> ToolpathPreset:
    if db.scalar(select(ToolpathPreset).where(ToolpathPreset.slug == payload.slug)):
        raise HTTPException(409, f"Пресет «{payload.slug}» уже существует")
    preset = ToolpathPreset(**payload.model_dump(), is_builtin=False)
    db.add(preset)
    db.flush()
    return preset


@router.put("/toolpath-presets/{preset_id}", response_model=ToolpathPresetOut)
def update_preset(
    preset_id: int, payload: ToolpathPresetIn, db: Session = Depends(get_db)
) -> ToolpathPreset:
    preset = db.get(ToolpathPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "Пресет не найден")
    for key, value in payload.model_dump().items():
        setattr(preset, key, value)
    # Пресет, изменённый технологом, перестаёт перезаписываться из конфига.
    preset.is_builtin = False
    db.flush()
    return preset


@router.delete("/toolpath-presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Session = Depends(get_db)) -> None:
    preset = db.get(ToolpathPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "Пресет не найден")
    db.delete(preset)
    db.flush()


@router.get("/parts/{part_id}/vectors", response_model=PartVectorsOut)
def part_vectors(part_id: int, db: Session = Depends(get_db)) -> PartVectorsOut:
    """Векторы детали и назначенные им траектории — то, что редактор
    показывает в списке объектов."""
    part = db.get(Part, part_id)
    if part is None:
        raise HTTPException(404, "Деталь не найдена")

    assignments = {
        row.target: row
        for row in db.scalars(
            select(PartToolpath).where(PartToolpath.part_id == part_id)
        ).all()
    }
    presets = {p.id: p for p in db.scalars(select(ToolpathPreset)).all()}

    vectors = []
    for vector in service.vectors_of(part).vectors:
        row = assignments.get(vector.target)
        preset = presets.get(row.preset_id) if row else None
        data = vector.as_dict()
        data["preset_id"] = preset.id if preset else None
        data["preset_name"] = preset.name if preset else None
        data["preset_color"] = preset.color if preset else None
        data["enabled"] = row.enabled if row else False
        data["assigned_manually"] = row.assigned_manually if row else False
        data["resolved_depth"] = (
            service.resolve_depth(
                preset, layer_depth=vector.depth, thickness=part.thickness
            )
            if preset
            else None
        )
        vectors.append(data)

    return PartVectorsOut(part_id=part.id, part_name=part.name, vectors=vectors)


@router.post("/parts/{part_id}/toolpaths", response_model=list[ToolpathAssignmentOut])
def assign_toolpath(
    part_id: int, payload: ToolpathAssignIn, db: Session = Depends(get_db)
) -> list[PartToolpath]:
    """«Выделил вектор — применил траекторию»."""
    try:
        return service.assign(
            db,
            part_id=part_id,
            targets=payload.targets,
            preset_id=payload.preset_id,
            overrides=payload.overrides,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/parts/{part_id}/toolpaths/auto", response_model=dict)
def auto_assign(part_id: int, db: Session = Depends(get_db)) -> dict:
    """Вернуть автоматические назначения по семантике, затерев ручные."""
    part = db.get(Part, part_id)
    if part is None:
        raise HTTPException(404, "Деталь не найдена")
    service.sync_presets(db)
    return {"assigned": service.auto_assign(db, part, overwrite=True)}
