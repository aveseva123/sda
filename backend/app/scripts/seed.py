"""Первичное наполнение справочников.

Материалы и инструмент — заглушки со ЗДРАВЫМИ, но НЕ подтверждёнными
заказчиком значениями. Их нужно заменить реальным справочником цеха:
форматы листов, цены, обрезка кромок, режимы резания.

Запуск:  python -m app.scripts.seed
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import LayerPreset, Material, Tool
from app.models.enums import ToolType
from app.resolve import builtin_presets

# Толщины 16, 12, 18 и 4 мм взяты из эталонных файлов заказчика: именно они
# встречаются в его выгрузках. Названия и цены — заглушки, их надо заменить
# реальным справочником цеха.
MATERIALS = [
    # name, thickness, has_grain, sheet_w, sheet_h, aliases
    ("ЛДСП Белый", 18.0, False, 2800.0, 2070.0, ["ldsp", "белый", "white"]),
    ("ЛДСП Дуб Сонома", 18.0, True, 2800.0, 2070.0, ["дуб", "сонома", "oak"]),
    ("ЛДСП Белый", 16.0, False, 2800.0, 2070.0, ["ldsp16"]),
    ("ЛДСП Белый", 15.0, False, 2800.0, 2070.0, ["ldsp15"]),
    ("ЛДСП Белый", 12.0, False, 2800.0, 2070.0, ["ldsp12"]),
    ("МДФ", 30.0, False, 2800.0, 2070.0, ["мдф", "mdf"]),
    ("ХДФ", 4.0, False, 2800.0, 2070.0, ["хдф", "hdf"]),
]

TOOLS = [
    # number, name, diameter, type, rpm, feed, plunge, step_down
    (1, "Компрессионная D8", 8.0, ToolType.COMPRESSION, 18000, 6000.0, 1500.0, 9.0),
    (2, "Концевая D6", 6.0, ToolType.END_MILL, 18000, 5000.0, 1200.0, 6.0),
    (3, "Сверло D8", 8.0, ToolType.DRILL, 6000, 1500.0, 800.0, 12.0),
    (4, "Сверло D5", 5.0, ToolType.DRILL, 6000, 1500.0, 800.0, 12.0),
    (5, "Пазовая D4", 4.0, ToolType.GROOVE, 18000, 3500.0, 900.0, 4.0),
]


def seed() -> None:
    db = SessionLocal()
    try:
        created = {"materials": 0, "tools": 0, "presets": 0}

        for name, thickness, grain, width, height, aliases in MATERIALS:
            exists = db.scalar(
                select(Material).where(
                    Material.name == name, Material.thickness == thickness
                )
            )
            if exists is not None:
                continue
            db.add(
                Material(
                    name=name,
                    thickness=thickness,
                    has_grain=grain,
                    sheet_w=width,
                    sheet_h=height,
                    aliases=aliases,
                )
            )
            created["materials"] += 1

        for number, name, diameter, kind, rpm, feed, plunge, step in TOOLS:
            if db.scalar(select(Tool).where(Tool.number == number)) is not None:
                continue
            db.add(
                Tool(
                    number=number,
                    name=name,
                    diameter=diameter,
                    type=kind,
                    rpm=rpm,
                    feed=feed,
                    plunge_feed=plunge,
                    step_down=step,
                )
            )
            created["tools"] += 1

        # Встроенные пресеты слоёв переносятся в БД, чтобы их можно было
        # править из мастера, не трогая конфиг.
        for preset in builtin_presets():
            name = preset.get("name")
            if not name or db.scalar(select(LayerPreset).where(LayerPreset.name == name)):
                continue
            db.add(
                LayerPreset(
                    name=name,
                    source=preset.get("source", "unknown"),
                    rules=preset.get("rules", []),
                    thickness_from_layer_regex=preset.get("thickness_from_layer_regex"),
                    is_builtin=True,
                )
            )
            created["presets"] += 1

        db.commit()
        print(
            "Добавлено: материалов {materials}, инструментов {tools}, "
            "пресетов слоёв {presets}.".format(**created)
        )
        print(
            "ВНИМАНИЕ: значения справочников — заглушки. Замените их реальными "
            "форматами листов, ценами и режимами резания перед работой."
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
