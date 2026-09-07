"""Геометрические примитивы: точка, отрезок, дуга, окружность, контур.

Всё в миллиметрах, ``float``; округление только при выводе в файл (раздел 0 ТЗ).
Примитивы — pydantic-модели, чтобы контуры деталей сериализовались в JSON-колонки
базы без отдельного слоя преобразований.

Соглашения:
* дуга задаётся началом, концом, центром и направлением (``ccw``) — ровно то,
  что нужно для ``G2/G3`` с ``I/J``;
* полная окружность — отдельный тип ``Circle``: дуга с совпадающими концами
  не имеет однозначной длины и запрещена валидатором;
* допуски в методы передаются явно — значения по умолчанию берутся из конфига
  (``defaults.yaml``), а не зашиты в код.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, model_validator

TWO_PI = 2.0 * math.pi


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Point(_Frozen):
    x: float
    y: float

    def distance_to(self, other: Point) -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def is_close(self, other: Point, tol: float) -> bool:
        """Совпадают ли точки с допуском ``tol`` (евклидово расстояние)."""
        return self.distance_to(other) <= tol

    def translated(self, dx: float, dy: float) -> Point:
        return Point(x=self.x + dx, y=self.y + dy)

    def angle_from(self, center: Point) -> float:
        """Полярный угол точки относительно ``center`` в радианах, [0, 2π)."""
        return math.atan2(self.y - center.y, self.x - center.x) % TWO_PI


class BBox(_Frozen):
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    @model_validator(mode="after")
    def _ordered(self) -> BBox:
        if self.min_x > self.max_x or self.min_y > self.max_y:
            raise ValueError("BBox: min должен быть не больше max по каждой оси")
        return self

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        return self.max_y - self.min_y

    def union(self, other: BBox) -> BBox:
        return BBox(
            min_x=min(self.min_x, other.min_x),
            min_y=min(self.min_y, other.min_y),
            max_x=max(self.max_x, other.max_x),
            max_y=max(self.max_y, other.max_y),
        )

    @classmethod
    def of_points(cls, points: list[Point]) -> BBox:
        if not points:
            raise ValueError("BBox.of_points: пустой список точек")
        return cls(
            min_x=min(p.x for p in points),
            min_y=min(p.y for p in points),
            max_x=max(p.x for p in points),
            max_y=max(p.y for p in points),
        )


class LineSegment(_Frozen):
    kind: Literal["line"] = "line"
    start: Point
    end: Point

    @property
    def length(self) -> float:
        return self.start.distance_to(self.end)

    @property
    def bbox(self) -> BBox:
        return BBox.of_points([self.start, self.end])

    def reversed(self) -> LineSegment:
        return LineSegment(start=self.end, end=self.start)


class ArcSegment(_Frozen):
    """Дуга окружности от ``start`` до ``end`` вокруг ``center``.

    ``ccw=True`` — против часовой стрелки (G3), иначе по часовой (G2).
    Радиус берётся как среднее расстояний от центра до концов; согласованность
    радиусов проверяется методом ``radius_mismatch`` с допуском из конфига.
    """

    kind: Literal["arc"] = "arc"
    start: Point
    end: Point
    center: Point
    ccw: bool

    @model_validator(mode="after")
    def _not_degenerate(self) -> ArcSegment:
        if self.start == self.end:
            raise ValueError(
                "ArcSegment: начало и конец совпадают — для полной окружности используйте Circle"
            )
        if self.center in (self.start, self.end):
            raise ValueError("ArcSegment: центр совпадает с концом дуги (нулевой радиус)")
        return self

    @property
    def radius(self) -> float:
        return 0.5 * (self.center.distance_to(self.start) + self.center.distance_to(self.end))

    @property
    def radius_mismatch(self) -> float:
        """Разница расстояний от центра до концов — мера некорректности дуги."""
        return abs(self.center.distance_to(self.start) - self.center.distance_to(self.end))

    @property
    def start_angle(self) -> float:
        return self.start.angle_from(self.center)

    @property
    def end_angle(self) -> float:
        return self.end.angle_from(self.center)

    @property
    def sweep(self) -> float:
        """Угол дуги в радианах, всегда положительный, в (0, 2π)."""
        delta = (self.end_angle - self.start_angle) % TWO_PI
        if not self.ccw:
            delta = (-delta) % TWO_PI
        # Концы различны, но могут лежать на одном луче из центра (разные радиусы) —
        # такую дугу считаем полным оборотом; проверка радиусов её всё равно отбракует.
        return delta if delta > 0.0 else TWO_PI

    @property
    def length(self) -> float:
        return self.radius * self.sweep

    def contains_angle(self, angle: float) -> bool:
        """Лежит ли направление ``angle`` (радианы) внутри дуги."""
        rel = (angle - self.start_angle) % TWO_PI
        if not self.ccw:
            rel = (-rel) % TWO_PI
        return rel <= self.sweep

    @property
    def bbox(self) -> BBox:
        """Точный габарит: концы плюс крайние точки по осям, попавшие внутрь дуги."""
        points = [self.start, self.end]
        r = self.radius
        for quadrant_angle, (dx, dy) in (
            (0.0, (r, 0.0)),
            (0.5 * math.pi, (0.0, r)),
            (math.pi, (-r, 0.0)),
            (1.5 * math.pi, (0.0, -r)),
        ):
            if self.contains_angle(quadrant_angle):
                points.append(self.center.translated(dx, dy))
        return BBox.of_points(points)

    def reversed(self) -> ArcSegment:
        return ArcSegment(start=self.end, end=self.start, center=self.center, ccw=not self.ccw)


Segment = Annotated[LineSegment | ArcSegment, Field(discriminator="kind")]


class Circle(_Frozen):
    kind: Literal["circle"] = "circle"
    center: Point
    radius: PositiveFloat

    @property
    def diameter(self) -> float:
        return 2.0 * self.radius

    @property
    def length(self) -> float:
        return TWO_PI * self.radius

    @property
    def bbox(self) -> BBox:
        return BBox(
            min_x=self.center.x - self.radius,
            min_y=self.center.y - self.radius,
            max_x=self.center.x + self.radius,
            max_y=self.center.y + self.radius,
        )


class Contour(BaseModel):
    """Цепочка сегментов. Замкнутость и связность — вопрос допуска, см. методы."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["contour"] = "contour"
    segments: list[Segment] = Field(min_length=1)

    def __iter__(self) -> Iterator[LineSegment | ArcSegment]:  # type: ignore[override]
        return iter(self.segments)

    @property
    def start(self) -> Point:
        return self.segments[0].start

    @property
    def end(self) -> Point:
        return self.segments[-1].end

    @property
    def length(self) -> float:
        return sum(s.length for s in self.segments)

    @property
    def bbox(self) -> BBox:
        box = self.segments[0].bbox
        for seg in self.segments[1:]:
            box = box.union(seg.bbox)
        return box

    def is_connected(self, tol: float) -> bool:
        """Конец каждого сегмента совпадает с началом следующего с допуском ``tol``."""
        return all(
            prev.end.is_close(nxt.start, tol)
            for prev, nxt in zip(self.segments, self.segments[1:], strict=False)
        )

    def is_closed(self, tol: float) -> bool:
        """Связный контур, у которого конец возвращается в начало с допуском ``tol``."""
        return self.is_connected(tol) and self.end.is_close(self.start, tol)

    def reversed(self) -> Contour:
        return Contour(segments=[s.reversed() for s in reversed(self.segments)])


Geometry = Annotated[Contour | Circle, Field(discriminator="kind")]
"""Геометрия операции: контур (замкнутый или открытый) либо окружность (отверстие)."""
