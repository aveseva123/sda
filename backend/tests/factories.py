"""Генераторы DXF-фикстур.

Реальных файлов заказчика пока нет, поэтому фикстуры воспроизводят
характерные особенности обоих источников: Базис отдаёт замкнутые полилинии
на осмысленных слоях, Fusion — россыпь несвязанных отрезков в слое 0.
Когда придут реальные DXF, эти фикстуры остаются как регрессионные.
"""

from __future__ import annotations

import math
from pathlib import Path

import ezdxf


def _new_doc() -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # миллиметры
    return doc


def bazis_part(
    path: Path,
    *,
    width: float = 600.0,
    height: float = 400.0,
    thickness: float = 18.0,
    sheet: tuple[float, float] = (2800.0, 2070.0),
    inset_depth: float = 12.0,
    drill_diameter: float = 8.0,
) -> Path:
    """Лист «как из Базиса», по образцу эталонных файлов заказчика.

    Слои устроены так же, как в реальных выгрузках:

      * ``BOARDS`` — контур ЛИСТА, а не детали;
      * ``PERIMETER D <глубина>`` — контур детали, глубина = толщина;
      * ``HOLES DIAM <⌀> D <глубина>`` — присадка;
      * ``INSETS D <глубина>`` — выборка, глубина меньше толщины.

    Ось Y направлена вниз от нуля, как в реальных файлах.
    """
    doc = _new_doc()
    msp = doc.modelspace()

    perimeter = f"PERIMETER D {thickness:.2f}"
    holes = f"HOLES DIAM {drill_diameter:.2f} D {thickness:.2f}"
    insets = f"INSETS D {inset_depth:.2f}"
    for name in ("BOARDS", perimeter, holes, insets):
        doc.layers.add(name)

    sheet_w, sheet_h = sheet
    msp.add_lwpolyline(
        [(0, 0), (sheet_w, 0), (sheet_w, -sheet_h), (0, -sheet_h)],
        close=True,
        dxfattribs={"layer": "BOARDS"},
    )

    x0, y0 = 16.0, -16.0
    msp.add_lwpolyline(
        [
            (x0, y0),
            (x0 + width, y0),
            (x0 + width, y0 - height),
            (x0, y0 - height),
        ],
        close=True,
        dxfattribs={"layer": perimeter},
    )
    for dx, dy in ((32.0, -50.0), (32.0, -(height - 50.0)), (width - 32.0, -50.0)):
        msp.add_circle(
            (x0 + dx, y0 + dy), drill_diameter / 2.0, dxfattribs={"layer": holes}
        )
    msp.add_lwpolyline(
        [
            (x0 + 100, y0 - 100),
            (x0 + 200, y0 - 100),
            (x0 + 200, y0 - 116),
            (x0 + 100, y0 - 116),
        ],
        close=True,
        dxfattribs={"layer": insets},
    )

    doc.saveas(path)
    return path


def repeated_parts(
    path: Path,
    *,
    count: int = 3,
    width: float = 600.0,
    height: float = 300.0,
    thickness: float = 18.0,
) -> Path:
    """Один лист с несколькими одинаковыми деталями.

    Так выглядит реальная выгрузка: одна и та же полка разложена по листу
    двадцать раз, и в дереве это должна быть одна позиция с количеством.
    """
    doc = _new_doc()
    msp = doc.modelspace()
    perimeter = f"PERIMETER D {thickness:.2f}"
    doc.layers.add("BOARDS")
    doc.layers.add(perimeter)

    sheet_w = 2800.0
    sheet_h = 2070.0
    msp.add_lwpolyline(
        [(0, 0), (sheet_w, 0), (sheet_w, -sheet_h), (0, -sheet_h)],
        close=True,
        dxfattribs={"layer": "BOARDS"},
    )
    for index in range(count):
        y = -20.0 - index * (height + 20.0)
        msp.add_lwpolyline(
            [(20, y), (20 + width, y), (20 + width, y - height), (20, y - height)],
            close=True,
            dxfattribs={"layer": perimeter},
        )
    doc.saveas(path)
    return path


def bazis_multi_thickness(
    path: Path,
    *,
    first: tuple[float, float, float] = (18.0, 1000.0, 600.0),
    second: tuple[float, float, float] = (4.0, 300.0, 200.0),
) -> Path:
    """Два листа РАЗНОЙ толщины в одном чертеже.

    Так выглядит реальная выгрузка заказчика: лист 18 мм и лист 4 мм рядом.
    Общий на файл ответ о толщине здесь был бы неверным для половины деталей.
    """
    doc = _new_doc()
    msp = doc.modelspace()
    doc.layers.add("BOARDS")

    offset = 0.0
    for thickness, width, height in (first, second):
        layer = f"PERIMETER D {thickness:.2f}"
        if layer not in doc.layers:
            doc.layers.add(layer)
        sheet_w, sheet_h = width + 100.0, height + 100.0
        msp.add_lwpolyline(
            [
                (0, offset),
                (sheet_w, offset),
                (sheet_w, offset - sheet_h),
                (0, offset - sheet_h),
            ],
            close=True,
            dxfattribs={"layer": "BOARDS"},
        )
        msp.add_lwpolyline(
            [
                (20, offset - 20),
                (20 + width, offset - 20),
                (20 + width, offset - 20 - height),
                (20, offset - 20 - height),
            ],
            close=True,
            dxfattribs={"layer": layer},
        )
        offset -= sheet_h + 40.0

    doc.saveas(path)
    return path


def fusion_part(
    path: Path,
    *,
    width: float = 800.0,
    height: float = 300.0,
    gap: float = 0.005,
    with_hole: bool = True,
) -> Path:
    """Деталь «как из Fusion»: всё в слое 0, контур разорван на отрезки,
    есть дубль линии и сплайн вместо дуги."""
    doc = _new_doc()
    msp = doc.modelspace()

    # Контур несвязанными сегментами с микроразрывом.
    msp.add_line((0, 0), (width, 0))
    msp.add_line((width, gap), (width, height))
    msp.add_line((width, height), (0, height))
    msp.add_line((0, height), (0, 0))
    # Дубль одной из линий — Fusion так умеет.
    msp.add_line((0, height), (0, 0))

    if with_hole:
        msp.add_lwpolyline(
            [(100, 100), (200, 100), (200, 200), (100, 200)],
            close=True,
        )

    # Сплайн в стороне — проверяем аппроксимацию.
    ctrl = [(300, 150), (330, 190), (370, 190), (400, 150)]
    msp.add_spline(ctrl)

    doc.saveas(path)
    return path


def fusion_part_with_arc(path: Path, radius: float = 50.0) -> Path:
    """Деталь со скруглённым углом: дуга должна разложиться в точки
    с допуском не хуже заданного."""
    doc = _new_doc()
    msp = doc.modelspace()
    w = h = 400.0
    msp.add_line((radius, 0), (w, 0))
    msp.add_line((w, 0), (w, h))
    msp.add_line((w, h), (0, h))
    msp.add_line((0, h), (0, radius))
    msp.add_arc(
        center=(radius, radius), radius=radius, start_angle=180, end_angle=270
    )
    doc.saveas(path)
    return path


def part_in_block(path: Path, width: float = 500.0, height: float = 350.0) -> Path:
    """Деталь, спрятанная в блоке: INSERT должен развернуться в геометрию."""
    doc = _new_doc()
    block = doc.blocks.new(name="DETAL")
    block.add_lwpolyline(
        [(0, 0), (width, 0), (width, height), (0, height)], close=True
    )
    block.add_circle((50, 50), 4.0)
    doc.modelspace().add_blockref("DETAL", insert=(1000, 1000))
    doc.saveas(path)
    return path


def multi_part_file(path: Path) -> Path:
    """Два независимых контура в одном файле."""
    doc = _new_doc()
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (300, 0), (300, 200), (0, 200)], close=True)
    msp.add_lwpolyline([(500, 0), (800, 0), (800, 200), (500, 200)], close=True)
    doc.saveas(path)
    return path


def circle_area(diameter: float) -> float:
    return math.pi * (diameter / 2.0) ** 2
