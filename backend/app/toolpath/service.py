"""Работа с траекториями: пресеты, векторы детали, назначения.

Модель работы взята из ArtCAM: геометрия детали — это набор ВЕКТОРОВ
(внешний контур, вырезы, присадка, пазы, карманы), и на каждый вектор
назначается стратегия обработки. Пресеты живут в конфиге и в БД, назначения
— отдельными строками, поэтому пресет можно поменять один раз для всех
деталей, а конкретному вектору задать исключение.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config_files import load
from app.models import Part, PartToolpath, Tool, ToolpathPreset

# Адреса векторов внутри геометрии детали.
OUTER = "outer"
INNER_PREFIX = "inner:"
OP_PREFIX = "op:"


def preset_config() -> dict:
    return load("toolpath_presets")


@dataclass(slots=True)
class Vector:
    """Один вектор детали — то, на что назначается траектория."""

    target: str
    semantic: str
    title: str
    # Габарит вектора и его длина — чтобы технолог узнал его в списке.
    bbox: tuple[float, float, float, float] | None = None
    length: float | None = None
    diameter: float | None = None
    depth: float | None = None
    points: int = 0

    def as_dict(self) -> dict:
        return {
            "target": self.target,
            "semantic": self.semantic,
            "title": self.title,
            "bbox": [round(v, 2) for v in self.bbox] if self.bbox else None,
            "length": round(self.length, 1) if self.length is not None else None,
            "diameter": self.diameter,
            "depth": self.depth,
            "points": self.points,
        }


@dataclass(slots=True)
class VectorList:
    vectors: list[Vector] = field(default_factory=list)

    def targets(self) -> list[str]:
        return [v.target for v in self.vectors]


def _ring_length(points: list) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:], strict=False):
        total += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    return total


def _bbox(points: list) -> tuple[float, float, float, float] | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def vectors_of(part: Part) -> VectorList:
    """Перечисляет векторы детали в том порядке, в каком их видит технолог."""
    result = VectorList()
    geometry = part.geometry or {}

    outer = geometry.get("outer") or []
    if outer:
        result.vectors.append(
            Vector(
                target=OUTER,
                semantic="OUTER",
                title="Внешний контур",
                bbox=_bbox(outer),
                length=_ring_length(outer),
                points=len(outer),
            )
        )

    for index, ring in enumerate(geometry.get("inners") or []):
        result.vectors.append(
            Vector(
                target=f"{INNER_PREFIX}{index}",
                semantic="INNER",
                title=f"Вырез {index + 1}",
                bbox=_bbox(ring),
                length=_ring_length(ring),
                points=len(ring),
            )
        )

    for index, op in enumerate(geometry.get("operations") or []):
        semantic = str(op.get("semantic", "OUTER"))
        diameter = op.get("diameter")
        if semantic == "DRILL" and diameter:
            title = f"Присадка ⌀{diameter:g}"
        else:
            title = {
                "GROOVE": "Паз",
                "POCKET": "Выборка",
                "MARK": "Гравировка",
            }.get(semantic, semantic)
            title = f"{title} {index + 1}"
        points = op.get("points") or []
        result.vectors.append(
            Vector(
                target=f"{OP_PREFIX}{index}",
                semantic=semantic,
                title=title,
                bbox=_bbox(points) if points else _op_bbox(op),
                length=_ring_length(points) if points else None,
                diameter=diameter,
                depth=op.get("depth"),
                points=len(points),
            )
        )
    return result


def _op_bbox(op: dict) -> tuple[float, float, float, float] | None:
    center = op.get("center")
    diameter = op.get("diameter")
    if not center or not diameter:
        return None
    radius = diameter / 2.0
    return (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius)


def sync_presets(db: Session) -> list[ToolpathPreset]:
    """Переносит пресеты из конфига в БД.

    Встроенные пресеты обновляются на месте, чтобы правка конфига доходила
    до уже заведённых назначений. Пресеты, созданные технологом, не трогаются.
    """
    config = preset_config()
    tools = {tool.type: tool for tool in db.scalars(select(Tool)).all()}
    created: list[ToolpathPreset] = []

    for entry in config.get("presets", []) or []:
        slug = entry.get("id")
        if not slug:
            continue
        preset = db.scalar(select(ToolpathPreset).where(ToolpathPreset.slug == slug))
        if preset is None:
            preset = ToolpathPreset(slug=slug, is_builtin=True)
            db.add(preset)
            created.append(preset)
        elif not preset.is_builtin:
            continue  # пресет технолога перезаписывать нельзя

        tool_cfg = entry.get("tool", {}) or {}
        matched_tool = tools.get(tool_cfg.get("type"))

        preset.name = entry.get("name", slug)
        preset.semantic = entry.get("semantic")
        preset.side = entry.get("side", "outside")
        preset.tool_id = matched_tool.id if matched_tool else None
        preset.tool_diameter = tool_cfg.get("diameter")
        preset.tool_type = tool_cfg.get("type")
        preset.depth = entry.get("depth", {}) or {}
        preset.step_down = entry.get("step_down")
        preset.finish_pass = bool(entry.get("finish_pass", False))
        preset.finish_allowance = entry.get("finish_allowance")
        preset.direction = entry.get("direction", "climb")
        preset.lead = entry.get("lead")
        preset.tabs = str(entry.get("tabs", "auto"))
        preset.color = entry.get("color", "#111827")
        preset.params = {
            key: value
            for key, value in entry.items()
            if key
            in {"pocket_strategy", "stepover", "peck"}
        } or None

    db.flush()
    return created


def preset_by_slug(db: Session, slug: str) -> ToolpathPreset | None:
    return db.scalar(select(ToolpathPreset).where(ToolpathPreset.slug == slug))


def auto_assign(db: Session, part: Part, *, overwrite: bool = False) -> int:
    """Раздаёт пресеты векторам детали по их семантике.

    Смысл в том, чтобы после импорта деталь уже была готова к обработке и
    технолог правил назначения, а не расставлял их с нуля. Назначения,
    сделанные вручную, не трогаются, если не попросили обратного.
    """
    mapping = (preset_config().get("defaults", {}) or {}).get("by_semantic", {}) or {}
    existing = {
        row.target: row
        for row in db.scalars(
            select(PartToolpath).where(PartToolpath.part_id == part.id)
        ).all()
    }

    assigned = 0
    for vector in vectors_of(part).vectors:
        slug = mapping.get(str(vector.semantic))
        if not slug:
            continue
        current = existing.get(vector.target)
        if current is not None and (current.assigned_manually and not overwrite):
            continue
        preset = preset_by_slug(db, slug)
        if preset is None:
            continue
        if current is None:
            db.add(
                PartToolpath(
                    part_id=part.id,
                    target=vector.target,
                    preset_id=preset.id,
                    assigned_manually=False,
                )
            )
        else:
            current.preset_id = preset.id
            current.assigned_manually = False
        assigned += 1

    db.flush()
    return assigned


def assign(
    db: Session,
    *,
    part_id: int,
    targets: list[str],
    preset_id: int,
    overrides: dict | None = None,
    enabled: bool = True,
) -> list[PartToolpath]:
    """Ручное назначение пресета на выбранные векторы — то самое «выделил
    вектор и применил траекторию»."""
    part = db.get(Part, part_id)
    if part is None:
        raise ValueError("Деталь не найдена")
    if db.get(ToolpathPreset, preset_id) is None:
        raise ValueError("Пресет не найден")

    known = set(vectors_of(part).targets())
    unknown = [t for t in targets if t not in known]
    if unknown:
        raise ValueError(f"В детали нет векторов: {', '.join(unknown)}")

    existing = {
        row.target: row
        for row in db.scalars(
            select(PartToolpath).where(PartToolpath.part_id == part_id)
        ).all()
    }

    out: list[PartToolpath] = []
    for target in targets:
        row = existing.get(target)
        if row is None:
            row = PartToolpath(part_id=part_id, target=target)
            db.add(row)
        row.preset_id = preset_id
        row.overrides = overrides
        row.enabled = enabled
        row.assigned_manually = True
        out.append(row)

    db.flush()
    return out


def assignments_of(db: Session, part_ids: list[int]) -> dict[int, list[PartToolpath]]:
    if not part_ids:
        return {}
    rows = db.scalars(
        select(PartToolpath).where(PartToolpath.part_id.in_(part_ids))
    ).all()
    grouped: dict[int, list[PartToolpath]] = {}
    for row in rows:
        grouped.setdefault(row.part_id, []).append(row)
    return grouped


def resolve_depth(preset: ToolpathPreset, *, layer_depth: float | None,
                  thickness: float | None) -> float | None:
    """Итоговая глубина обработки для вектора.

    Приоритет: глубина из слоя -> насквозь по толщине -> фиксированная.
    Так один пресет работает и там, где источник несёт глубину (Базис),
    и там, где её нет (Fusion).
    """
    spec = preset.depth or {}
    mode = spec.get("mode", "fixed")
    overcut = float(spec.get("overcut", 0.0) or 0.0)

    def through() -> float | None:
        return None if thickness is None else round(thickness + overcut, 3)

    if mode == "from_layer":
        if layer_depth is not None:
            return round(float(layer_depth), 3)
        fallback = spec.get("fallback", "through")
        if fallback == "through":
            return through()
        value = spec.get("value")
        return None if value is None else round(float(value), 3)

    if mode == "through":
        return through()

    value = spec.get("value")
    return None if value is None else round(float(value), 3)
