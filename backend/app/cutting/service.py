"""Пресеты раскроя: синхронизация с конфигом и подбор под материал.

Словарь параметров взят из ArtCAM, но работает иначе: технолог не отвечает
на диалог по каждой траектории, а один раз настраивает пресет на материал.
Дальше пресет подбирается сам по паре «материал + толщина», а задание
запоминает, с каким пресетом было посчитано, — старую УП можно повторить
точь-в-точь.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config_files import load
from app.models import CuttingPreset, Material

# Группы параметров, которые пресет держит как есть — ровно те, что технолог
# видит на экране пресета.
GROUPS = ("placement", "depth", "strategy", "tools", "safety", "post")


def preset_config() -> dict:
    return load("cutting_presets")


def sync_presets(db: Session) -> list[CuttingPreset]:
    """Переносит пресеты из config/cutting_presets.yaml в БД.

    Встроенные пресеты обновляются на месте: правка конфига доходит до уже
    заведённых заданий. Пресет, который технолог изменил через интерфейс,
    перестаёт быть встроенным и больше не перезаписывается.
    """
    config = preset_config()
    default_slug = config.get("default")
    created: list[CuttingPreset] = []

    for entry in config.get("presets", []) or []:
        slug = entry.get("id")
        if not slug:
            continue
        preset = db.scalar(select(CuttingPreset).where(CuttingPreset.slug == slug))
        if preset is None:
            preset = CuttingPreset(slug=slug, is_builtin=True)
            db.add(preset)
            created.append(preset)
        elif not preset.is_builtin:
            continue

        preset.name = entry.get("name", slug)
        preset.applies_to = entry.get("applies_to", {}) or {}
        for group in GROUPS:
            setattr(preset, group, entry.get(group, {}) or {})
        preset.order = list(entry.get("order", []) or [])
        preset.is_default = bool(entry.get("is_default", slug == default_slug))

    db.flush()
    return created


def all_presets(db: Session) -> list[CuttingPreset]:
    sync_presets(db)
    return list(db.scalars(select(CuttingPreset).order_by(CuttingPreset.id)).all())


def default_preset(db: Session) -> CuttingPreset | None:
    return db.scalar(
        select(CuttingPreset)
        .where(CuttingPreset.is_default.is_(True))
        .order_by(CuttingPreset.id)
    )


def _matches(preset: CuttingPreset, *, material: Material, thickness: float) -> int | None:
    """Насколько пресет подходит паре «материал + толщина».

    Возвращает вес совпадения (больше — точнее) или ``None``, если пресет
    не подходит вовсе. Толщина обязана совпасть: раскрой 16 мм на листе 18
    прорежет жертвенный стол насквозь.
    """
    rules = preset.applies_to or {}

    declared = rules.get("thickness")
    if declared is None:
        return None
    if abs(float(declared) - float(thickness)) > 0.01:
        return None

    weight = 1
    pattern = rules.get("material_regex")
    if pattern:
        try:
            if not re.search(pattern, material.name or ""):
                return None
        except re.error:
            return None
        weight += 1
    return weight


def preset_for(
    db: Session, *, material: Material, thickness: float
) -> CuttingPreset | None:
    """Пресет под пару «материал + толщина».

    Молча ничего не выдумываем: если под толщину пресета нет, задание
    останется без него, и технолог выберет вручную — это видно в интерфейсе.
    Пресет по умолчанию подставляется только если он подходит по толщине.
    """
    sync_presets(db)
    best: tuple[int, CuttingPreset] | None = None
    for preset in db.scalars(select(CuttingPreset).order_by(CuttingPreset.id)).all():
        weight = _matches(preset, material=material, thickness=thickness)
        if weight is None:
            continue
        if best is None or weight > best[0] or (weight == best[0] and preset.is_default):
            best = (weight, preset)
    return best[1] if best else None


def placement_params(preset: CuttingPreset | None) -> dict:
    """Параметры пресета, которые управляют раскладкой на листе.

    Зазор между контурами деталей — это диаметр фрезы контура плюс мостик
    из пресета: фреза идёт по стороне контура и съедает свой полный диаметр
    между двумя соседними деталями.

    Обрезку кромок пресет не трогает: её держит карточка материала —
    она описывает конкретную партию листов, а не способ обработки.
    """
    if preset is None:
        return {}

    placement = preset.placement or {}
    params: dict = {}

    outer = preset.tool_for("OUTER") or {}
    diameter = outer.get("diameter")
    if diameter is not None:
        params["kerf"] = float(diameter)
    if placement.get("part_gap") is not None:
        params["part_gap"] = float(placement["part_gap"])
    if placement.get("sheet_margin") is not None:
        params["sheet_margin"] = float(placement["sheet_margin"])

    rotation = str(placement.get("rotation", "quarter"))
    if rotation == "none":
        params["rotations"] = [0.0]
    elif rotation in {"quarter", "free"}:
        # Укладка идёт по габаритам, поэтому «free» пока читается как четверти;
        # произвольный угол появится вместе с раскладкой по контуру.
        params["rotation_step"] = 90

    if placement.get("respect_grain") is not None:
        params["respect_grain"] = bool(placement["respect_grain"])
    return params


def summary(preset: CuttingPreset | None) -> dict | None:
    """Короткая карточка пресета — то, что показывается в панели задания."""
    if preset is None:
        return None
    outer = preset.tool_for("OUTER") or {}
    depth = preset.depth or {}
    strategy = preset.strategy or {}
    return {
        "id": preset.id,
        "slug": preset.slug,
        "name": preset.name,
        "thickness": preset.thickness(),
        "is_default": preset.is_default,
        "is_builtin": preset.is_builtin,
        "tool": outer.get("name"),
        "tool_diameter": outer.get("diameter"),
        "step_z": depth.get("step_z"),
        "strategy": strategy.get("type"),
        "direction": strategy.get("direction"),
        "order": list(preset.order or []),
    }
