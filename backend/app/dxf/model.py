"""Структуры данных DXF-конвейера.

Конвейер: сырой DXF → примитивы (``Primitive``) → нормализация → контуры →
``PartShape``/``Operation`` → JSONB в ``parts.geometry``. Всё, что идёт
дальше (нестинг, CAM, рендер, стикеры), работает уже только с этим
представлением и DXF больше не открывает.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

Point = tuple[float, float]


class PrimitiveKind(StrEnum):
    PATH = "path"        # линия/дуга/полилиния/сплайн — уже в виде точек
    CIRCLE = "circle"    # окружность сохраняется как окружность: из неё
                         # берётся диаметр присадки
    TEXT = "text"        # TEXT/MTEXT — читается как метаданные, не как геометрия


@dataclass(slots=True)
class Primitive:
    layer: str
    dxftype: str
    kind: PrimitiveKind
    points: list[Point] = field(default_factory=list)
    closed: bool = False
    center: Point | None = None
    radius: float | None = None
    text: str = ""

    @property
    def diameter(self) -> float | None:
        return None if self.radius is None else self.radius * 2.0


@dataclass(slots=True)
class LayerInfo:
    """Сводка по слою для Мастера сопоставления слоёв."""

    name: str
    count: int
    dxftypes: dict[str, int]
    closed_paths: int
    circles: int
    texts: int
    # Габарит геометрии слоя — по нему видно, слой это детали или рамка листа.
    bbox: tuple[float, float, float, float] | None = None
    # Диаметры окружностей на слое: если это присадка, здесь будут 5/8/15/20.
    circle_diameters: list[float] = field(default_factory=list)
    # Назначенная семантика (после применения пресета).
    semantic: str | None = None

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "count": self.count,
            "dxftypes": self.dxftypes,
            "closed_paths": self.closed_paths,
            "circles": self.circles,
            "texts": self.texts,
            "bbox": list(self.bbox) if self.bbox else None,
            "circle_diameters": self.circle_diameters,
            "semantic": self.semantic,
        }


@dataclass(slots=True)
class Operation:
    """Технологическая операция, извлечённая из DXF.

    Глубина здесь НЕ хранится: DXF двумерен. Глубина назначается правилами
    из ``config/depth_rules.yaml`` на этапе генерации УП.
    """

    semantic: str
    kind: str                       # circle | path | contour
    layer: str
    points: list[Point] = field(default_factory=list)
    closed: bool = False
    center: Point | None = None
    diameter: float | None = None

    def as_dict(self) -> dict:
        data: dict = {
            "semantic": self.semantic,
            "kind": self.kind,
            "layer": self.layer,
            "closed": self.closed,
        }
        if self.points:
            data["points"] = [[round(x, 4), round(y, 4)] for x, y in self.points]
        if self.center is not None:
            data["center"] = [round(self.center[0], 4), round(self.center[1], 4)]
        if self.diameter is not None:
            data["diameter"] = round(self.diameter, 4)
        return data


@dataclass(slots=True)
class PartShape:
    """Геометрия одной детали: внешний контур, внутренние вырезы, операции."""

    outer: list[Point]
    inners: list[list[Point]] = field(default_factory=list)
    operations: list[Operation] = field(default_factory=list)
    area: float = 0.0
    bbox: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)

    @property
    def length(self) -> float:
        """Больший габарит детали, мм."""
        return round(max(self.bbox[2] - self.bbox[0], self.bbox[3] - self.bbox[1]), 3)

    @property
    def width(self) -> float:
        """Меньший габарит детали, мм."""
        return round(min(self.bbox[2] - self.bbox[0], self.bbox[3] - self.bbox[1]), 3)

    def as_dict(self) -> dict:
        return {
            "outer": [[round(x, 4), round(y, 4)] for x, y in self.outer],
            "inners": [
                [[round(x, 4), round(y, 4)] for x, y in ring] for ring in self.inners
            ],
            "operations": [op.as_dict() for op in self.operations],
            "area": round(self.area, 3),
            "bbox": [round(v, 4) for v in self.bbox],
            "length": self.length,
            "width": self.width,
        }


@dataclass(slots=True)
class DxfScan:
    """Результат чтения DXF до применения семантики слоёв."""

    primitives: list[Primitive]
    layers: list[LayerInfo]
    texts: list[str]
    detected_source: str
    acad_version: str = ""
    # Проблемы, замеченные при чтении: незакрытые контуры, сшитые разрывы,
    # выброшенные дубли. Показываются технологу.
    warnings: list[str] = field(default_factory=list)

    def layer_names(self) -> list[str]:
        return [layer.name for layer in self.layers]
