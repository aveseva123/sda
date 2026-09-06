"""Разбор чертежа на листы, детали и операции.

Тип операции определяется ГЕОМЕТРИЕЙ вектора, а не слоем: у одного
источника слои осмысленные, у другого всё лежит в слое «0», и правило по
слою там не работает вовсе. Форма контура есть всегда.

Слой сохраняет две роли: он несёт глубину обработки там, где источник её
пишет (Базис: «INSETS D 12.00»), и служит запасной подсказкой. Без глубины
сквозной вырез и карман неразличимы — сверху они выглядят одинаково.

Вложенность считается по СКВОЗНЫМ контурам. Карман не вскрывает материал,
поэтому отверстие внутри кармана — по-прежнему отверстие в той же детали,
а не новая деталь на «дне». Именно так устроены реальные выгрузки: круглая
выборка ⌀270 на 6 мм, а внутри неё сквозное ⌀240.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass

from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from app.core.config_files import geometry_config
from app.dxf.classify import classify_circle, classify_closed, classify_open
from app.dxf.layer_meta import LayerMeta
from app.dxf.model import Operation, PartShape, Primitive, PrimitiveKind, SheetRegion
from app.dxf.normalize import canonical_signature, deduplicate, path_length, stitch
from app.models.enums import LayerSemantic

_SKIP_SEMANTICS = {LayerSemantic.INFO, LayerSemantic.IGNORE}


@dataclass(slots=True)
class Ring:
    """Замкнутый контур вместе с тем, откуда он пришёл."""

    polygon: Polygon
    layer: str
    exact_diameter: float | None = None


class ContourResult:
    def __init__(self) -> None:
        self.shapes: list[PartShape] = []
        self.sheets: list[SheetRegion] = []
        self.warnings: list[str] = []
        self.detected: Counter = Counter()

    def sheets_as_dicts(self) -> list[dict]:
        return [sheet.as_dict() for sheet in self.sheets]


def build_shapes(
    primitives: list[Primitive],
    semantic_by_layer: dict[str, str],
    *,
    default_semantic: str = LayerSemantic.OUTER,
    layer_meta: dict[str, LayerMeta] | None = None,
) -> ContourResult:
    cfg = geometry_config()
    stitch_tol = float(cfg.get("stitch_tolerance", 0.01))
    dup_tol = float(cfg.get("duplicate_tolerance", 0.01))
    min_perimeter = float(cfg.get("min_contour_perimeter", 0.5))
    meta = layer_meta or {}

    result = ContourResult()
    rings, open_chains, sheet_rings = _collect(
        primitives, semantic_by_layer, default_semantic, stitch_tol, dup_tol, min_perimeter
    )

    result.sheets = _build_sheets(sheet_rings, min_perimeter)
    sheet_boxes = [(sheet, Polygon(_rect(sheet.bbox))) for sheet in result.sheets]

    rings = _dedupe_across_layers(rings, meta, dup_tol)

    if open_chains:
        result.warnings.append(
            f"Незамкнутых цепочек после сшивки: {len(open_chains)}. "
            "Они разобраны как пазы — проверьте, нет ли среди них "
            "разорванных контуров деталей."
        )

    if not rings:
        result.warnings.append("В файле не найдено ни одного замкнутого контура.")
        return result

    ordered, children, roots = _build_tree(rings)

    pending = list(roots)
    seen: set[int] = set()
    while pending:
        index = pending.pop(0)
        if index in seen:
            continue
        seen.add(index)
        shape, islands = _build_part(ordered, children, index, meta, semantic_by_layer, result)
        shape.sheet_index = _sheet_of(sheet_boxes, Polygon(shape.outer))
        result.shapes.append(shape)
        pending.extend(islands)

    _attach_open_chains(result, open_chains, meta, semantic_by_layer)
    _assign_sheet_thickness(result)
    _report(result)
    return result


# --------------------------------------------------------------------------
# Сбор геометрии
# --------------------------------------------------------------------------


def _collect(
    primitives: list[Primitive],
    semantic_by_layer: dict[str, str],
    default_semantic: str,
    stitch_tol: float,
    dup_tol: float,
    min_perimeter: float,
) -> tuple[list[Ring], list[tuple[list, str]], list[list]]:
    contours_by_layer: dict[str, list[tuple[list, bool]]] = defaultdict(list)
    circles: list[Primitive] = []
    sheet_rings: list[list] = []

    for prim in primitives:
        if prim.kind is PrimitiveKind.TEXT:
            continue
        semantic = semantic_by_layer.get(prim.layer, default_semantic)
        if semantic in _SKIP_SEMANTICS:
            continue
        if semantic == LayerSemantic.SHEET:
            if len(prim.points) >= 3:
                sheet_rings.append(list(prim.points))
            continue
        if prim.kind is PrimitiveKind.CIRCLE:
            circles.append(prim)
            continue
        if len(prim.points) >= 2:
            contours_by_layer[prim.layer].append((list(prim.points), prim.closed))

    rings: list[Ring] = []
    open_chains: list[tuple[list, str]] = []

    for layer, entries in contours_by_layer.items():
        chains = deduplicate(
            [chain for chain, _ in entries], dup_tol, [flag for _, flag in entries]
        )
        closed, leftovers = stitch(chains, stitch_tol)
        for ring in closed:
            if path_length(ring) < min_perimeter:
                continue
            poly = _to_polygon(ring)
            if poly is not None and poly.area > 0:
                rings.append(Ring(poly, layer))
        open_chains.extend((chain, layer) for chain in leftovers)

    # Окружности участвуют в определении вложенности наравне с полилиниями:
    # круглая деталь приходит одной окружностью и не должна потеряться.
    for prim in circles:
        if len(prim.points) < 3:
            continue
        poly = _to_polygon(list(prim.points) + [prim.points[0]])
        if poly is not None and poly.area > 0:
            rings.append(Ring(poly, prim.layer, exact_diameter=prim.diameter))

    return rings, open_chains, sheet_rings


def _dedupe_across_layers(
    rings: list[Ring], meta: dict[str, LayerMeta], tol: float
) -> list[Ring]:
    """Схлопывает контуры, совпавшие на разных слоях.

    В реальных выгрузках один и тот же ⌀240 нарисован и на слое выборки
    (глубина 6), и на слое отверстий (глубина 18). Побеждает бо́льшая
    глубина: сквозной рез поглощает более мелкий проход по тому же контуру.
    """
    best: dict[tuple, Ring] = {}
    order: list[tuple] = []
    for ring in rings:
        signature = canonical_signature(list(ring.polygon.exterior.coords), tol, True)
        if not signature:
            continue
        current = best.get(signature)
        if current is None:
            best[signature] = ring
            order.append(signature)
            continue
        current_depth = _depth_of(current.layer, meta) or 0.0
        candidate_depth = _depth_of(ring.layer, meta) or 0.0
        if candidate_depth > current_depth:
            best[signature] = ring
    return [best[signature] for signature in order]


def _depth_of(layer: str, meta: dict[str, LayerMeta]) -> float | None:
    entry = meta.get(layer)
    return entry.depth if entry else None


# --------------------------------------------------------------------------
# Дерево вложенности и сборка детали
# --------------------------------------------------------------------------


def _build_tree(
    rings: list[Ring],
) -> tuple[list[Ring], dict[int, list[int]], list[int]]:
    ordered = sorted(rings, key=lambda r: r.polygon.area, reverse=True)
    children: dict[int, list[int]] = defaultdict(list)
    roots: list[int] = []

    for i, ring in enumerate(ordered):
        container: int | None = None
        probe = ring.polygon.representative_point()
        for j in range(i):
            if ordered[j].polygon.contains(probe):
                container = j
        if container is None:
            roots.append(i)
        else:
            children[container].append(i)
    return ordered, children, roots


def _build_part(
    ordered: list[Ring],
    children: dict[int, list[int]],
    root: int,
    meta: dict[str, LayerMeta],
    semantic_by_layer: dict[str, str],
    result: ContourResult,
) -> tuple[PartShape, list[int]]:
    """Собирает деталь из корневого контура и всего, что внутри неё.

    Возвращает деталь и индексы островков — контуров, оказавшихся внутри
    СКВОЗНОГО выреза: материала под ними нет, значит это отдельные детали.
    """
    outer = ordered[root]
    thickness = _depth_of(outer.layer, meta)
    shape = PartShape(
        outer=list(outer.polygon.exterior.coords),
        bbox=outer.polygon.bounds,
        area=outer.polygon.area,
        source_layer=outer.layer,
        thickness_hint=thickness,
    )
    result.detected[str(LayerSemantic.OUTER)] += 1

    islands: list[int] = []
    queue = list(children.get(root, []))
    holes_area = 0.0

    while queue:
        index = queue.pop(0)
        child = ordered[index]
        depth = _depth_of(child.layer, meta)
        hint = semantic_by_layer.get(child.layer)

        if child.exact_diameter is not None:
            verdict = classify_circle(
                child.exact_diameter,
                layer_depth=depth,
                thickness=thickness,
                layer_semantic=hint,
            )
        else:
            verdict = classify_closed(
                child.polygon,
                is_outermost=False,
                layer_depth=depth,
                layer_semantic=hint,
                thickness=thickness,
            )

        result.detected[str(verdict.semantic)] += 1
        _attach(shape, child, verdict)

        if verdict.semantic == LayerSemantic.INNER:
            holes_area += child.polygon.area
            # Под сквозным вырезом материала нет — то, что там лежит,
            # это отдельные детали, а не части этой.
            islands.extend(children.get(index, []))
        else:
            # Карман и присадка материал не вскрывают: вложенное в них
            # по-прежнему принадлежит этой детали.
            queue.extend(children.get(index, []))

    shape.area = outer.polygon.area - holes_area
    return shape, islands


def _attach(shape: PartShape, child: Ring, verdict) -> None:
    ring = list(child.polygon.exterior.coords)

    if verdict.semantic == LayerSemantic.INNER:
        shape.inners.append(ring)
        return

    if verdict.semantic == LayerSemantic.DRILL:
        centroid = child.polygon.centroid
        shape.operations.append(
            Operation(
                semantic=LayerSemantic.DRILL,
                kind="circle",
                layer=child.layer,
                center=(round(centroid.x, 4), round(centroid.y, 4)),
                diameter=verdict.diameter,
                depth=verdict.depth,
                closed=True,
            )
        )
        return

    shape.operations.append(
        Operation(
            semantic=verdict.semantic,
            kind="contour",
            layer=child.layer,
            points=ring,
            closed=True,
            depth=verdict.depth,
        )
    )


def _attach_open_chains(
    result: ContourResult,
    open_chains: list[tuple[list, str]],
    meta: dict[str, LayerMeta],
    semantic_by_layer: dict[str, str],
) -> None:
    """Незамкнутые цепочки — пазы, привязываются к детали, внутри которой лежат."""
    for chain, layer in open_chains:
        verdict = classify_open(
            chain,
            layer_depth=_depth_of(layer, meta),
            layer_semantic=semantic_by_layer.get(layer),
        )
        if verdict is None:
            continue
        host = _shape_containing(result.shapes, chain[len(chain) // 2])
        if host is None:
            continue
        result.detected[str(verdict.semantic)] += 1
        host.operations.append(
            Operation(
                semantic=verdict.semantic,
                kind="path",
                layer=layer,
                points=list(chain),
                closed=False,
                depth=verdict.depth,
            )
        )


def _shape_containing(shapes: list[PartShape], point) -> PartShape | None:
    probe = ShPoint(point)
    for shape in shapes:
        minx, miny, maxx, maxy = shape.bbox
        if not (minx <= point[0] <= maxx and miny <= point[1] <= maxy):
            continue
        if Polygon(shape.outer).contains(probe):
            return shape
    return None


# --------------------------------------------------------------------------
# Листы и сводка
# --------------------------------------------------------------------------


def _rect(bbox: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    minx, miny, maxx, maxy = bbox
    return [(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy), (minx, miny)]


def _build_sheets(rings: list[list], min_perimeter: float) -> list[SheetRegion]:
    boxes: list[tuple[float, float, float, float]] = []
    for ring in rings:
        if path_length(ring) < min_perimeter:
            continue
        poly = _to_polygon(ring if ring[0] == ring[-1] else ring + [ring[0]])
        if poly is None or poly.area <= 0:
            continue
        boxes.append(poly.bounds)
    boxes.sort(key=lambda b: (-b[3], b[0]))
    return [SheetRegion(index=i, bbox=box) for i, box in enumerate(boxes)]


def _sheet_of(sheet_boxes: list[tuple[SheetRegion, Polygon]], part: Polygon) -> int | None:
    if not sheet_boxes:
        return None
    probe = part.representative_point()
    for sheet, poly in sheet_boxes:
        if poly.contains(probe):
            return sheet.index
    return None


def _assign_sheet_thickness(result: ContourResult) -> None:
    per_sheet: dict[int, Counter] = defaultdict(Counter)
    for shape in result.shapes:
        if shape.sheet_index is None or shape.thickness_hint is None:
            continue
        per_sheet[shape.sheet_index][shape.thickness_hint] += 1
    for sheet in result.sheets:
        counts = per_sheet.get(sheet.index)
        if counts:
            sheet.thickness = counts.most_common(1)[0][0]


def _report(result: ContourResult) -> None:
    if result.sheets:
        orphans = sum(1 for shape in result.shapes if shape.sheet_index is None)
        if orphans:
            result.warnings.append(
                f"Деталей вне контуров листов: {orphans}. "
                "Проверьте, все ли листы размечены."
            )
    elif len(result.shapes) > 1:
        result.warnings.append(
            f"В файле {len(result.shapes)} независимых контуров — вероятно, "
            "несколько деталей в одном DXF."
        )


def _to_polygon(ring: list) -> Polygon | None:
    if len(ring) < 4:
        return None
    try:
        poly = Polygon(ring)
    except Exception:
        return None
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    if poly.is_empty or poly.geom_type != "Polygon":
        return None
    return poly
