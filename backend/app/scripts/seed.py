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
# Справочник заводится сразу рабочим: все ходовые толщины в тех форматах,
# в которых лист реально приезжает на склад. Названия обобщённые — декор и
# поставщик дописываются в карточке материала.
#
# Текстура: у фанеры направление волокна важно, у ЛДСП и МДФ — нет.
SHEET_LDSP = (2070.0, 2800.0)
SHEET_MDF = (2070.0, 2800.0)
SHEET_PLY = (2440.0, 1220.0)

LDSP_THICKNESS = [8.0, 10.0, 16.0, 18.0, 22.0, 25.0, 28.0, 38.0]
MDF_THICKNESS = [3.0, 4.0, 6.0, 8.0, 10.0, 12.0, 16.0, 18.0, 19.0, 22.0, 25.0]
PLY_THICKNESS = [4.0, 6.0, 8.0, 9.0, 10.0, 12.0, 15.0, 18.0, 21.0, 24.0, 27.0, 30.0]


def _materials() -> list[tuple]:
    """name, thickness, has_grain, sheet_w, sheet_h, aliases."""
    rows: list[tuple] = []
    for thickness in LDSP_THICKNESS:
        rows.append(("ЛДСП", thickness, False, *SHEET_LDSP, ["ldsp", "лдсп"]))
    for thickness in MDF_THICKNESS:
        rows.append(("МДФ", thickness, False, *SHEET_MDF, ["mdf", "мдф"]))
    for thickness in PLY_THICKNESS:
        rows.append(("Фанера", thickness, True, *SHEET_PLY, ["fanera", "фанера", "ply"]))
    # ХДФ ходит задними стенками — формат тот же, что у ЛДСП.
    for thickness in (3.0, 4.0):
        rows.append(("ХДФ", thickness, False, *SHEET_LDSP, ["hdf", "хдф"]))
    return rows


MATERIALS = _materials()


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
