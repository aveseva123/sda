"""Разбор технологии из имени слоя DXF.

Отдельный модуль без зависимостей от остального приложения: им пользуются
и разбор геометрии (``app.dxf.contours``), и мастер сопоставления слоёв
(``app.resolve.layers``). Держать это в ``resolve`` нельзя — получится
циклический импорт.

Базис пишет в имя слоя глубину обработки и диаметр отверстия:

    PERIMETER D 16.00          -> глубина 16.00 мм
    INSETS D 6.00              -> глубина 6.00 мм
    HOLES DIAM 4.00 D 16.00    -> отверстие ⌀4.00 на глубину 16.00 мм

Это важнее, чем кажется: DXF двумерен и обычно глубину не несёт, поэтому
в ТЗ она задавалась только правилами. Для этого источника глубина есть
в файле, и она достовернее правил.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config_files import layer_presets


def drill_diameters() -> tuple[tuple[float, ...], float]:
    """Диаметры, характерные для мебельной присадки, и допуск.

    Используются для подсказок мастера и для флага ``circles_as_drill``.
    Решение всё равно подтверждает пользователь.
    """
    cfg = layer_presets().get("drill_diameters", {}) or {}
    values = tuple(float(v) for v in cfg.get("values", [5, 8, 10, 15, 20, 26, 35]))
    return values, float(cfg.get("tolerance", 0.6))


def looks_like_drill(diameter: float) -> bool:
    values, tolerance = drill_diameters()
    return any(abs(diameter - value) <= tolerance for value in values)


def parse_layer_attributes(layer_name: str) -> dict[str, float]:
    """Извлекает глубину и диаметр из имени слоя по регуляркам из конфига."""
    attributes: dict[str, float] = {}
    for key, rule in (layer_presets().get("layer_attributes", {}) or {}).items():
        pattern = (rule or {}).get("regex")
        if not pattern:
            continue
        match = re.search(pattern, layer_name)
        if not match:
            continue
        try:
            attributes[key] = float(match.group("value").replace(",", "."))
        except (IndexError, ValueError):
            continue
    return attributes


@dataclass(slots=True)
class LayerMeta:
    """Всё, что известно об одном слое после применения пресета."""

    name: str
    semantic: str
    depth: float | None = None
    hole_diameter: float | None = None
    circles_as_drill: bool = False

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "semantic": str(self.semantic),
            "depth": self.depth,
            "hole_diameter": self.hole_diameter,
            "circles_as_drill": self.circles_as_drill,
        }
