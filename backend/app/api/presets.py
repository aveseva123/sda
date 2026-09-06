from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config_files import (
    app_config,
    depth_rules,
    filename_templates,
    reload_all,
)
from app.core.db import get_db
from app.models import LayerPreset
from app.resolve import builtin_presets, semantics_catalog
from app.schemas import LayerPresetIn, LayerPresetOut

router = APIRouter(tags=["Настройки"])


@router.get("/layer-presets", response_model=list[LayerPresetOut])
def list_presets(db: Session = Depends(get_db)) -> list[LayerPreset]:
    """Сохранённые пресеты. Встроенные из конфига добавляются как read-only."""
    saved = list(db.scalars(select(LayerPreset).order_by(LayerPreset.name)).all())
    saved_names = {p.name for p in saved}
    virtual = [
        LayerPreset(
            id=-(index + 1),
            name=preset.get("name", f"preset-{index}"),
            source=preset.get("source", "unknown"),
            rules=preset.get("rules", []),
            thickness_from_layer_regex=preset.get("thickness_from_layer_regex"),
            is_builtin=True,
        )
        for index, preset in enumerate(builtin_presets())
        if preset.get("name") not in saved_names
    ]
    return saved + virtual


@router.post("/layer-presets", response_model=LayerPresetOut, status_code=201)
def save_preset(payload: LayerPresetIn, db: Session = Depends(get_db)) -> LayerPreset:
    """Сохранение результата Мастера сопоставления слоёв.

    Пресет с тем же именем перезаписывается: технолог правит карту слоёв
    по мере того, как встречает новые слои у источника.
    """
    preset = db.scalar(select(LayerPreset).where(LayerPreset.name == payload.name))
    rules = [rule.model_dump(exclude_none=True) for rule in payload.rules]
    if preset is None:
        preset = LayerPreset(name=payload.name, is_builtin=False)
        db.add(preset)
    preset.source = payload.source
    preset.rules = rules
    preset.thickness_from_layer_regex = payload.thickness_from_layer_regex
    db.flush()
    return preset


@router.delete("/layer-presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Session = Depends(get_db)) -> None:
    preset = db.get(LayerPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "Пресет не найден")
    db.delete(preset)
    db.flush()


@router.get("/config", response_model=dict)
def get_config() -> dict:
    """Конфигурация, нужная интерфейсу: толщины, шаблоны имён, семантики."""
    return {
        "thicknesses": app_config().get("thicknesses", {}),
        "geometry": app_config().get("geometry", {}),
        "import": app_config().get("import", {}),
        "labels": app_config().get("labels", {}),
        "filename_templates": filename_templates().get("templates", []),
        "semantics": semantics_catalog(),
        "depth_rules": depth_rules().get("rules", []),
    }


@router.post("/config/reload", response_model=dict)
def reload_config() -> dict:
    """Перечитать YAML-конфиги без перезапуска сервиса."""
    reload_all()
    return {"status": "ok"}
