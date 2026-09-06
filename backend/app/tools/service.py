"""Библиотека фрез и магазин станка.

Смена инструмента у Дайхонга ручная, поэтому платформа различает две вещи:
что стоит в магазине (слоты T1…T8) и что лежит в ящике. Фрезу вне магазина
оператор ставит руками, и УП должна об этом предупредить, а не молча
переключить инструмент.

Ресурс считается по пройденному В МАТЕРИАЛЕ пути — холостые проходы фрезу не
тупят. Для свёрел ресурс меряется отверстиями.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config_files import load
from app.models import CuttingPreset, Tool


def tools_config() -> dict:
    return load("tools")


def magazine_slots() -> int:
    return int(tools_config().get("magazine_slots", 8))


def warning_ratio() -> float:
    return float(tools_config().get("resource_warning", 0.8))


def sync_tools(db: Session) -> list[Tool]:
    """Переносит фрезы из config/tools.yaml в БД.

    Фреза, заведённая или изменённая технологом, из конфига не
    перезаписывается: в цеху инструмент меняют чаще, чем правят конфиги.
    """
    created: list[Tool] = []
    existing = {tool.name: tool for tool in db.scalars(select(Tool)).all()}

    for index, entry in enumerate(tools_config().get("tools", []) or []):
        name = entry.get("name")
        if not name:
            continue
        tool = existing.get(name)
        if tool is None:
            tool = Tool(name=name, is_builtin=True)
            db.add(tool)
            created.append(tool)
        elif not tool.is_builtin:
            continue

        resource = entry.get("resource", {}) or {}
        modes = entry.get("modes", []) or []
        tool.number = int(entry.get("slot") or index + 1)
        tool.slot = entry.get("slot")
        tool.type = entry.get("type", "end_mill")
        tool.diameter = float(entry.get("diameter", 6.0))
        tool.flute_length = entry.get("flute_length")
        tool.total_length = entry.get("total_length")
        tool.flutes = entry.get("flutes")
        tool.shank = entry.get("shank")
        tool.article = entry.get("article")
        tool.rpm = int(entry.get("rpm", 18000))
        tool.feed = float(entry.get("feed", 4000.0))
        tool.plunge_feed = float(entry.get("plunge_feed", 1200.0))
        tool.step_down = float(entry.get("step_down", 6.0))
        tool.resource_used = float(resource.get("used", 0.0))
        tool.resource_limit = resource.get("limit")
        tool.resource_unit = str(resource.get("unit", "м"))
        tool.modes = modes

    db.flush()
    return created


def all_tools(db: Session) -> list[Tool]:
    sync_tools(db)
    return list(
        db.scalars(
            # Сначала магазин по слотам, потом то, что лежит в ящике.
            select(Tool).order_by(Tool.slot.is_(None), Tool.slot, Tool.diameter)
        ).all()
    )


def resource_state(tool: Tool) -> dict:
    """Насколько израсходована фреза и пора ли её менять."""
    limit = float(tool.resource_limit or 0.0)
    used = float(tool.resource_used or 0.0)
    ratio = round(used / limit, 3) if limit else None
    return {
        "used": used,
        "limit": tool.resource_limit,
        "unit": tool.resource_unit,
        "ratio": ratio,
        "low": bool(ratio is not None and ratio >= warning_ratio()),
    }


def usage(db: Session, tool: Tool) -> list[str]:
    """Где фреза используется: пресеты раскроя, которые её называют."""
    where: list[str] = []
    for preset in db.scalars(select(CuttingPreset).order_by(CuttingPreset.id)).all():
        for semantic, entry in (preset.tools or {}).items():
            entries = entry if isinstance(entry, list) else [entry]
            for item in entries:
                if not isinstance(item, dict):
                    continue
                same_slot = tool.slot is not None and item.get("slot") == f"T{tool.slot}"
                same_size = abs(float(item.get("diameter", 0.0)) - tool.diameter) < 0.01
                if same_slot or same_size:
                    where.append(f"Пресет «{preset.name}» · {semantic}")
                    break
    return sorted(set(where))


def magazine(db: Session) -> list[dict]:
    """Слоты магазина станка: что стоит, что свободно."""
    tools = {tool.slot: tool for tool in all_tools(db) if tool.slot}
    return [
        {
            "slot": slot,
            "tool_id": tools[slot].id if slot in tools else None,
            "name": tools[slot].name if slot in tools else None,
            "diameter": tools[slot].diameter if slot in tools else None,
            "low": resource_state(tools[slot])["low"] if slot in tools else False,
        }
        for slot in range(1, magazine_slots() + 1)
    ]


def as_dict(db: Session, tool: Tool) -> dict:
    return {
        "id": tool.id,
        "slot": tool.slot,
        "name": tool.name,
        "type": tool.type,
        "diameter": tool.diameter,
        "flute_length": tool.flute_length,
        "total_length": tool.total_length,
        "flutes": tool.flutes,
        "shank": tool.shank,
        "article": tool.article,
        "rpm": tool.rpm,
        "feed": tool.feed,
        "plunge_feed": tool.plunge_feed,
        "step_down": tool.step_down,
        "min_radius": tool.min_radius,
        "resource": resource_state(tool),
        "modes": tool.modes or [],
        "usage": usage(db, tool),
        "is_builtin": tool.is_builtin,
    }
