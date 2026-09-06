"""Раскладка деталей по листам.

Алгоритм — bottom-left-fill по габаритным прямоугольникам: детали
сортируются по убыванию площади и укладываются в самую нижнюю-левую
свободную позицию. Для мебели, где деталей прямоугольных большинство, это
даёт разумный результат и, главное, честную стартовую точку для ручной
правки: технолог двигает детали в редакторе, а алгоритм не спорит.

Ограничение, названное прямо: укладка идёт по габаритам, а не по реальному
контуру, поэтому фигурная деталь не вложится в вырез другой. Настоящий
нестинг по no-fit polygon — следующий шаг; интерфейс и модель данных к нему
уже готовы, менять их не придётся.

Зафиксированные вручную детали (``pinned``) пересчёт не двигает.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.config_files import app_config
from app.models import GrainMode

# Допуск сравнения координат: платформа округляет их до 0.001 мм, поэтому
# «ровно впритык с зазором» не должно читаться как пересечение из-за
# накопленной ошибки сложения.
EPS = 0.001


def nesting_config() -> dict:
    return app_config().get("nesting", {}) or {}


@dataclass(slots=True)
class Piece:
    """Деталь, которую надо уложить."""

    instance_id: int
    part_id: int
    w: float
    h: float
    grain: str = GrainMode.NONE
    pinned: bool = False
    x: float | None = None
    y: float | None = None
    rotation: float = 0.0

    def size(self, rotation: float) -> tuple[float, float]:
        return (self.h, self.w) if int(rotation) % 180 == 90 else (self.w, self.h)


@dataclass(slots=True)
class Placement:
    instance_id: int
    sheet_index: int
    x: float
    y: float
    rotation: float


@dataclass(slots=True)
class SheetPlan:
    index: int
    w: float
    h: float
    # Полезная область с учётом обрезки кромок листа.
    offset_x: float = 0.0
    offset_y: float = 0.0
    placements: list[Placement] = field(default_factory=list)
    used_area: float = 0.0

    @property
    def utilization(self) -> float:
        total = self.w * self.h
        return round(self.used_area / total, 4) if total else 0.0


@dataclass(slots=True)
class LayoutResult:
    sheets: list[SheetPlan] = field(default_factory=list)
    unplaced: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def utilization(self) -> float:
        total = sum(s.w * s.h for s in self.sheets)
        used = sum(s.used_area for s in self.sheets)
        return round(used / total, 4) if total else 0.0


def allowed_rotations(grain: str, has_grain: bool) -> list[float]:
    """Какие повороты допустимы для детали.

    У текстурного материала деталь нельзя класть поперёк волокна, поэтому
    остаются только 0° и 180°.
    """
    cfg = nesting_config()
    if has_grain and grain != GrainMode.NONE:
        return [float(a) for a in cfg.get("grain_rotations", [0, 180])]
    step = int(cfg.get("rotation_step", 90)) or 90
    return [float(a) for a in range(0, 360, step)]


def _overlaps(
    ax: float, ay: float, aw: float, ah: float,
    bx: float, by: float, bw: float, bh: float,
    gap: float,
) -> bool:
    return not (
        ax + aw + gap <= bx + EPS
        or bx + bw + gap <= ax + EPS
        or ay + ah + gap <= by + EPS
        or by + bh + gap <= ay + EPS
    )


def _fits(
    plan: SheetPlan, sizes: dict[int, tuple[float, float, float, float]],
    x: float, y: float, w: float, h: float, gap: float,
) -> bool:
    if x < plan.offset_x - EPS or y < plan.offset_y - EPS:
        return False
    if x + w > plan.offset_x + plan.w + EPS or y + h > plan.offset_y + plan.h + EPS:
        return False
    for placed in plan.placements:
        px, py, pw, ph = sizes[placed.instance_id]
        if _overlaps(x, y, w, h, px, py, pw, ph, gap):
            return False
    return True


def _candidate_points(plan: SheetPlan, sizes: dict, gap: float) -> list[tuple[float, float]]:
    """Точки-кандидаты: левый нижний угол листа и углы уже уложенных деталей."""
    points = [(plan.offset_x, plan.offset_y)]
    for placed in plan.placements:
        px, py, pw, ph = sizes[placed.instance_id]
        points.append((px + pw + gap, py))
        points.append((px, py + ph + gap))
    # Нижние-левые точки первыми: так деталь садится максимально низко и влево.
    return sorted(set(points), key=lambda p: (p[1], p[0]))


def pack(
    pieces: list[Piece],
    *,
    sheet_w: float,
    sheet_h: float,
    trim: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0),
    has_grain: bool = False,
    max_sheets: int | None = None,
) -> LayoutResult:
    """Укладывает детали по листам одного формата.

    ``trim`` — обрезка кромок листа (лево, право, низ, верх).
    """
    cfg = nesting_config()
    gap = float(cfg.get("kerf", 8.0)) + float(cfg.get("part_gap", 0.0))
    margin = float(cfg.get("sheet_margin", 0.0))

    trim_l, trim_r, trim_b, trim_t = trim
    usable_w = sheet_w - trim_l - trim_r - 2 * margin
    usable_h = sheet_h - trim_b - trim_t - 2 * margin
    offset_x = trim_l + margin
    offset_y = trim_b + margin

    result = LayoutResult()
    if usable_w <= 0 or usable_h <= 0:
        result.warnings.append("Обрезка кромок больше самого листа.")
        return result

    order = cfg.get("order", "area_desc")
    movable = [p for p in pieces if not p.pinned]
    if order == "area_desc":
        movable.sort(key=lambda p: (-(p.w * p.h), -max(p.w, p.h)))

    # Зафиксированные детали ложатся первыми и остаются на своих местах.
    sizes: dict[int, tuple[float, float, float, float]] = {}
    for piece in pieces:
        if not piece.pinned or piece.x is None or piece.y is None:
            continue
        index = 0
        while len(result.sheets) <= index:
            result.sheets.append(
                SheetPlan(len(result.sheets), usable_w, usable_h, offset_x, offset_y)
            )
        plan = result.sheets[index]
        w, h = piece.size(piece.rotation)
        plan.placements.append(
            Placement(piece.instance_id, index, piece.x, piece.y, piece.rotation)
        )
        sizes[piece.instance_id] = (piece.x, piece.y, w, h)
        plan.used_area += w * h

    for piece in movable:
        placed = False
        for plan in result.sheets:
            if _place_on(plan, piece, sizes, gap, has_grain):
                placed = True
                break
        if placed:
            continue

        if max_sheets is not None and len(result.sheets) >= max_sheets:
            result.unplaced.append(piece.instance_id)
            continue

        plan = SheetPlan(len(result.sheets), usable_w, usable_h, offset_x, offset_y)
        result.sheets.append(plan)
        if not _place_on(plan, piece, sizes, gap, has_grain):
            # Не влезает даже в пустой лист — деталь больше листа.
            result.sheets.pop()
            result.unplaced.append(piece.instance_id)

    if result.unplaced:
        result.warnings.append(
            f"Не удалось разместить деталей: {len(result.unplaced)}. "
            "Проверьте габариты листа и обрезку кромок."
        )
    return result


def _place_on(
    plan: SheetPlan, piece: Piece, sizes: dict, gap: float, has_grain: bool
) -> bool:
    for rotation in allowed_rotations(piece.grain, has_grain):
        w, h = piece.size(rotation)
        for x, y in _candidate_points(plan, sizes, gap):
            if _fits(plan, sizes, x, y, w, h, gap):
                plan.placements.append(
                    Placement(piece.instance_id, plan.index, round(x, 3), round(y, 3), rotation)
                )
                sizes[piece.instance_id] = (x, y, w, h)
                plan.used_area += w * h
                return True
    return False
