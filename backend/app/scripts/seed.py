"""Первичное наполнение справочников — первый шаг боевого запуска.

Материалы — заглушки со ЗДРАВЫМИ, но НЕ подтверждёнными заказчиком
значениями: форматы листов, цены и обрезку кромок надо заменить реальными.
Фрезы и пресеты раскроя не выдумываются здесь заново, а переносятся из
config/tools.yaml и config/cutting_presets.yaml — иначе справочник разъедется
с тем, что стоит в станке.

Скрипт можно запускать повторно: он добавляет только недостающее.

Запуск:  python -m app.scripts.seed
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.db import SessionLocal
from app.cutting import service as cutting
from app.models import LayerPreset, Material
from app.resolve import builtin_presets
from app.tools import service as tools

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



def seed() -> None:
    db = SessionLocal()
    try:
        created = {"materials": 0, "tools": 0, "presets": 0, "cutting": 0}

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

        # Фрезы и пресеты раскроя живут в config/*.yaml — единственный
        # источник правды. Дублировать их списком в коде нельзя: справочник
        # разъедется с тем, что реально стоит в станке.
        created["tools"] = len(tools.sync_tools(db))
        created["cutting"] = len(cutting.sync_presets(db))

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
            "Добавлено: материалов {materials}, фрез {tools}, "
            "пресетов раскроя {cutting}, пресетов слоёв {presets}.".format(**created)
        )
        print(
            "ВНИМАНИЕ: значения справочников — заглушки. Замените их реальными "
            "форматами листов, ценами и режимами резания перед работой."
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
