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
    thickness_text: str = "Толщина 18",
) -> Path:
    """Деталь «как из Базиса»: замкнутый габарит, присадка с диаметрами,
    паз, текстовая аннотация на служебном слое."""
    doc = _new_doc()
    msp = doc.modelspace()
    for name in ("ГАБАРИТ", "ПРИСАДКА", "ПАЗ", "ТЕКСТ"):
        doc.layers.add(name)

    msp.add_lwpolyline(
        [(0, 0), (width, 0), (width, height), (0, height)],
        close=True,
        dxfattribs={"layer": "ГАБАРИТ"},
    )
    # Присадка: конфирмат ⌀8 и чашка петли ⌀35.
    for x, y, d in ((32, 50, 8.0), (32, height - 50, 8.0), (100, 200, 35.0)):
        msp.add_circle((x, y), d / 2.0, dxfattribs={"layer": "ПРИСАДКА"})
    # Паз под ХДФ — открытая линия, замыкать её не нужно.
    msp.add_line((10, 10), (width - 10, 10), dxfattribs={"layer": "ПАЗ"})
    msp.add_text(
        thickness_text, dxfattribs={"layer": "ТЕКСТ"}
    ).set_placement((10, height + 20))

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
