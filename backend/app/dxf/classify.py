"""Определение типа операции ПО ГЕОМЕТРИИ вектора.

Слой — только запасная подсказка и источник глубины. Причина: у Базиса слои
осмысленные, у выгрузки из Fusion всё лежит в слое ``0``, и правило,
опирающееся на слой, там не работает вовсе. Форма контура есть всегда.

    замкнутый, самый внешний      -> раскрой по контуру
    замкнутый внутри другого      -> вырез или карман, решает глубина
    незамкнутая линия/полилиния   -> паз по центру
    окружность ⌀3–35 мм           -> присадка

Почему глубина всё же нужна: у выборки 12 мм на листе 16 мм сверху тот же
вид, что у сквозного выреза. Отличить их по геометрии невозможно в принципе,
поэтому там, где источник пишет глубину в имя слоя, она и решает.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import Polygon

from app.core.config_files import load
from app.models.enums import LayerSemantic


def vector_rules() -> dict:
    return load("vector_rules")


@dataclass(slots=True)
class Classification:
    semantic: str
    # Почему принято такое решение — показывается технологу.
    reason: str
    diameter: float | None = None
    depth: float | None = None
    # Геометрия решила однозначно или пришлось опереться на слой.
    from_geometry: bool = True


def circularity(polygon: Polygon) -> float:
    """Насколько контур похож на окружность: 1.0 — идеальный круг.

    Считается как отношение площади к площади круга того же периметра.
    Устойчивее сравнения с описанной окружностью: не ломается на
    многоугольной аппроксимации дуг.
    """
    if polygon.length <= 0:
        return 0.0
    return min(1.0, 4.0 * math.pi * polygon.area / (polygon.length**2))


def equivalent_diameter(polygon: Polygon) -> float:
    """Диаметр круга той же площади."""
    return 2.0 * math.sqrt(max(polygon.area, 0.0) / math.pi)


def classify_closed(
    polygon: Polygon,
    *,
    is_outermost: bool,
    layer_depth: float | None,
    layer_semantic: str | None,
    thickness: float | None,
) -> Classification:
    """Классифицирует замкнутый контур."""
    rules = vector_rules()
    drill_cfg = rules.get("drill", {}) or {}

    if is_outermost:
        return Classification(
            LayerSemantic.OUTER, "замкнутый контур верхнего уровня", depth=layer_depth
        )

    # Отверстие под фурнитуру: круглое и в мебельном диапазоне диаметров.
    round_enough = circularity(polygon) >= float(drill_cfg.get("circularity", 0.93))
    diameter = equivalent_diameter(polygon)
    if round_enough and _in_drill_range(diameter, drill_cfg):
        return Classification(
            LayerSemantic.DRILL,
            f"окружность ⌀{diameter:.1f} мм в диапазоне присадки",
            diameter=round(diameter, 3),
            depth=layer_depth,
        )

    # Вырез или карман — различает только глубина.
    return _by_depth(
        layer_depth=layer_depth, thickness=thickness, layer_semantic=layer_semantic
    )


def classify_open(
    points: list,
    *,
    layer_depth: float | None,
    layer_semantic: str | None,
) -> Classification | None:
    """Классифицирует незамкнутую цепочку. ``None`` — отбросить как мусор."""
    rules = vector_rules()
    groove_cfg = rules.get("groove", {}) or {}
    fallback = rules.get("fallback", {}) or {}

    length = _path_length(points)
    if length < float(groove_cfg.get("min_length", 5.0)):
        return None

    if fallback.get("use_layer_semantic", True) and layer_semantic in {
        LayerSemantic.MARK,
        LayerSemantic.GROOVE,
    }:
        return Classification(
            str(layer_semantic),
            f"незамкнутая линия, слой указывает «{layer_semantic}»",
            depth=layer_depth,
            from_geometry=False,
        )

    suspicious = float(fallback.get("suspicious_open_length", 500.0))
    if length > suspicious:
        return Classification(
            LayerSemantic.GROOVE,
            f"незамкнутая линия длиной {length:.0f} мм — проверьте, "
            "не разорванный ли это контур детали",
            depth=layer_depth,
        )

    return Classification(
        LayerSemantic.GROOVE, "незамкнутая линия — паз по центру", depth=layer_depth
    )


def classify_circle(
    diameter: float,
    *,
    layer_depth: float | None,
    thickness: float | None = None,
    layer_semantic: str | None = None,
) -> Classification:
    """Классифицирует примитив CIRCLE, у которого диаметр известен точно.

    Диаметр решает только вопрос «присадка или нет». Всё остальное —
    сквозной вырез или выборка — решает глубина, ровно как у полилинии:
    круглая выборка ⌀270 на 6 мм и сквозное круглое окно ⌀270 сверху
    выглядят одинаково.
    """
    drill_cfg = vector_rules().get("drill", {}) or {}
    if _in_drill_range(diameter, drill_cfg):
        return Classification(
            LayerSemantic.DRILL,
            f"окружность ⌀{diameter:g} мм в диапазоне присадки",
            diameter=diameter,
            depth=layer_depth,
        )

    verdict = _by_depth(
        layer_depth=layer_depth, thickness=thickness, layer_semantic=layer_semantic
    )
    verdict.diameter = diameter
    verdict.reason = f"окружность ⌀{diameter:g} мм крупнее присадки: {verdict.reason}"
    return verdict


def _in_drill_range(diameter: float, drill_cfg: dict) -> bool:
    """Попадает ли диаметр в мебельный диапазон присадки.

    Допуск нужен из-за аппроксимации: окружность ⌀3 приходит полигоном, чей
    эквивалентный диаметр 2.998, и без допуска отверстие ровно на границе
    диапазона потерялось бы.
    """
    tolerance = float(drill_cfg.get("diameter_tolerance", 0.05))
    return (
        float(drill_cfg.get("min_diameter", 3.0)) - tolerance
        <= diameter
        <= float(drill_cfg.get("max_diameter", 35.0)) + tolerance
    )


def _by_depth(
    *, layer_depth: float | None, thickness: float | None, layer_semantic: str | None
) -> Classification:
    """Сквозной вырез или выборка — различает только глубина."""
    pocket_cfg = vector_rules().get("pocket", {}) or {}

    if layer_depth is not None and thickness is not None:
        if layer_depth < thickness - float(pocket_cfg.get("through_tolerance", 0.6)):
            return Classification(
                LayerSemantic.POCKET,
                f"глубина {layer_depth:g} мм меньше толщины {thickness:g} мм",
                depth=layer_depth,
                from_geometry=False,
            )
        return Classification(
            LayerSemantic.INNER,
            f"глубина {layer_depth:g} мм — насквозь",
            depth=layer_depth,
        )

    if layer_semantic in {LayerSemantic.POCKET, LayerSemantic.MARK}:
        return Classification(
            str(layer_semantic),
            f"глубина неизвестна, слой указывает «{layer_semantic}»",
            depth=layer_depth,
            from_geometry=False,
        )

    return Classification(
        LayerSemantic.INNER, "замкнутый контур внутри детали", depth=layer_depth
    )


def _path_length(points: list) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:], strict=False):
        total += math.hypot(x2 - x1, y2 - y1)
    return total
