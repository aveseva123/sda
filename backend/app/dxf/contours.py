"""Разбор примитивов в листы и детали.

Реальные выгрузки заказчика — это уже разложенные листы: слой ``BOARDS``
несёт контуры ЛИСТОВ, а не деталей, и в одном чертеже листов бывает
несколько, в том числе разной толщины. Поэтому разбор идёт в два шага:
сначала выделяются листы, затем детали распределяются по ним.

Вложенность контуров определяется по геометрии (площадь + вхождение), а не
по слою — это нужно для источников без мебельной семантики, где всё лежит
в слое ``0``.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from app.core.config_files import geometry_config
from app.dxf.layer_meta import LayerMeta, looks_like_drill
from app.dxf.model import Operation, PartShape, Primitive, PrimitiveKind, SheetRegion
from app.dxf.normalize import deduplicate, path_length, stitch
from app.models.enums import LayerSemantic

# Семантики, дающие замкнутый контур детали.
_CONTOUR_SEMANTICS = {LayerSemantic.OUTER, LayerSemantic.INNER}
# Семантики, дающие операции внутри детали.
_OPERATION_SEMANTICS = {
    LayerSemantic.DRILL,
    LayerSemantic.GROOVE,
    LayerSemantic.POCKET,
    LayerSemantic.MARK,
}
_SKIP_SEMANTICS = {LayerSemantic.INFO, LayerSemantic.IGNORE}


class ContourResult:
    def __init__(self) -> None:
        self.shapes: list[PartShape] = []
        self.sheets: list[SheetRegion] = []
        self.warnings: list[str] = []

    def sheets_as_dicts(self) -> list[dict]:
        return [sheet.as_dict() for sheet in self.sheets]


def build_shapes(
    primitives: list[Primitive],
    semantic_by_layer: dict[str, str],
    *,
    default_semantic: str = LayerSemantic.OUTER,
    layer_meta: dict[str, LayerMeta] | None = None,
) -> ContourResult:
    """Строит листы и детали из примитивов.

    ``semantic_by_layer`` — результат применения пресета слоёв. Слои, для
    которых семантика не назначена, получают ``default_semantic``.
    ``layer_meta`` несёт глубину и диаметр, разобранные из имени слоя.
    """
    cfg = geometry_config()
    stitch_tol = float(cfg.get("stitch_tolerance", 0.01))
    dup_tol = float(cfg.get("duplicate_tolerance", 0.01))
    min_perimeter = float(cfg.get("min_contour_perimeter", 0.5))
    meta = layer_meta or {}

    result = ContourResult()

    # Контурные цепочки группируются по слою: сшивать контур одного слоя
    # с контуром другого нельзя — это разные технологические сущности.
    contours_by_layer: dict[str, list[tuple[list, bool]]] = defaultdict(list)
    sheet_rings: list[list] = []
    drill_prims: list[Primitive] = []
    op_prims: list[tuple[str, Primitive]] = []

    for prim in primitives:
        if prim.kind is PrimitiveKind.TEXT:
            continue
        semantic = semantic_by_layer.get(prim.layer, default_semantic)
        if semantic in _SKIP_SEMANTICS:
            continue

        if semantic == LayerSemantic.SHEET:
            if prim.kind is PrimitiveKind.CIRCLE and len(prim.points) >= 3:
                sheet_rings.append(list(prim.points) + [prim.points[0]])
            elif len(prim.points) >= 3:
                sheet_rings.append(list(prim.points))
            continue

        if semantic == LayerSemantic.DRILL:
            drill_prims.append(prim)
            continue

        if semantic in _OPERATION_SEMANTICS:
            op_prims.append((semantic, prim))
            continue

        if semantic in _CONTOUR_SEMANTICS:
            if prim.kind is PrimitiveKind.CIRCLE:
                entry = meta.get(prim.layer)
                # Окружность мебельного диаметра на контурном слое — это
                # присадка, а не круглый вырез. Включается флагом в мастере.
                if (
                    entry is not None
                    and entry.circles_as_drill
                    and prim.diameter is not None
                    and looks_like_drill(prim.diameter)
                ):
                    drill_prims.append(prim)
                    continue
                if len(prim.points) >= 3:
                    contours_by_layer[prim.layer].append(
                        (list(prim.points) + [prim.points[0]], True)
                    )
                continue
            if len(prim.points) >= 2:
                contours_by_layer[prim.layer].append((list(prim.points), prim.closed))

    result.sheets = _build_sheets(sheet_rings, min_perimeter)
    sheet_polygons = [
        (sheet, Polygon(_rect(sheet.bbox))) for sheet in result.sheets
    ]

    # (полигон, слой) — слой нужен, чтобы взять глубину и вывести толщину.
    polygons: list[tuple[Polygon, str]] = []
    open_total = 0
    for layer, entries in contours_by_layer.items():
        chains = deduplicate(
            [chain for chain, _ in entries], dup_tol, [flag for _, flag in entries]
        )
        closed_rings, open_chains = stitch(chains, stitch_tol)
        open_total += len(open_chains)
        for ring in closed_rings:
            if path_length(ring) < min_perimeter:
                continue
            poly = _to_polygon(ring)
            if poly is not None and poly.area > 0:
                polygons.append((poly, layer))

    if open_total:
        result.warnings.append(
            f"Незакрытых контуров после сшивки: {open_total}. "
            "Проверьте разрывы в исходном DXF."
        )

    if not polygons:
        result.warnings.append("В файле не найдено ни одного замкнутого контура.")
        return result

    for outer_poly, outer_layer, hole_polys in _resolve_nesting(polygons):
        entry = meta.get(outer_layer)
        shape = PartShape(
            outer=list(outer_poly.exterior.coords),
            inners=[list(h.exterior.coords) for h in hole_polys],
            bbox=outer_poly.bounds,
            area=outer_poly.area - sum(h.area for h in hole_polys),
            source_layer=outer_layer,
            thickness_hint=entry.depth if entry else None,
        )
        shape.operations.extend(_drill_operations(drill_prims, outer_poly, meta))
        shape.operations.extend(_path_operations(op_prims, outer_poly, meta))
        shape.sheet_index = _sheet_of(sheet_polygons, outer_poly)
        result.shapes.append(shape)

    _assign_sheet_thickness(result)

    if result.sheets:
        orphans = sum(1 for shape in result.shapes if shape.sheet_index is None)
        if orphans:
            result.warnings.append(
                f"Деталей вне контуров листов: {orphans}. "
                "Проверьте, все ли листы размечены на слое контуров листа."
            )
    elif len(result.shapes) > 1:
        result.warnings.append(
            f"В файле {len(result.shapes)} независимых контуров — вероятно, "
            "несколько деталей в одном DXF."
        )
    return result


def _rect(bbox: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    minx, miny, maxx, maxy = bbox
    return [(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy), (minx, miny)]


def _build_sheets(rings: list[list], min_perimeter: float) -> list[SheetRegion]:
    """Контуры листов. Порядок — сверху вниз, слева направо: так же, как
    их видит технолог на чертеже."""
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


def _sheet_of(
    sheet_polygons: list[tuple[SheetRegion, Polygon]], part: Polygon
) -> int | None:
    if not sheet_polygons:
        return None
    probe = part.representative_point()
    for sheet, poly in sheet_polygons:
        if poly.contains(probe):
            return sheet.index
    return None


def _assign_sheet_thickness(result: ContourResult) -> None:
    """Толщина листа = преобладающая глубина контуров деталей на нём.

    Именно так в одном чертеже уживаются листы разной толщины: лист 18 мм
    с деталями на ``PERIMETER D 18.00`` и лист 4 мм с деталью на
    ``PERIMETER D 4.00``.
    """
    per_sheet: dict[int, Counter] = defaultdict(Counter)
    for shape in result.shapes:
        if shape.sheet_index is None or shape.thickness_hint is None:
            continue
        per_sheet[shape.sheet_index][shape.thickness_hint] += 1

    for sheet in result.sheets:
        counts = per_sheet.get(sheet.index)
        if counts:
            sheet.thickness = counts.most_common(1)[0][0]


def _to_polygon(ring: list) -> Polygon | None:
    if len(ring) < 4:
        return None
    try:
        poly = Polygon(ring)
    except Exception:
        return None
    if not poly.is_valid:
        # Самопересечения после сшивки — buffer(0) их вычищает.
        poly = poly.buffer(0)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    if poly.is_empty or poly.geom_type != "Polygon":
        return None
    return poly


def _resolve_nesting(
    polygons: list[tuple[Polygon, str]],
) -> list[tuple[Polygon, str, list[Polygon]]]:
    """Определяет вложенность по площади и вхождению.

    Контур верхнего уровня = не лежит внутри другого. Контуры, лежащие
    непосредственно в нём, становятся его вырезами. Третий уровень
    вложенности (остров внутри выреза) снова становится деталью.
    """
    ordered = sorted(polygons, key=lambda item: item[0].area, reverse=True)
    depth: list[int] = []
    parent: list[int | None] = []

    for i, (poly, _) in enumerate(ordered):
        # Ближайший (наименьший по площади) контейнер среди больших контуров.
        container: int | None = None
        probe = poly.representative_point()
        for j in range(i):
            if ordered[j][0].contains(probe):
                container = j
        depth.append(0 if container is None else depth[container] + 1)
        parent.append(container)

    groups: list[tuple[Polygon, str, list[Polygon]]] = []
    for i, (poly, layer) in enumerate(ordered):
        if depth[i] % 2 != 0:
            continue  # нечётная глубина — это вырез, а не деталь
        holes = [
            ordered[j][0]
            for j in range(len(ordered))
            if parent[j] == i and depth[j] % 2 == 1
        ]
        groups.append((poly, layer, holes))
    return groups


def _drill_operations(
    prims: list[Primitive], outer: Polygon, meta: dict[str, LayerMeta]
) -> list[Operation]:
    """Присадка: диаметр берётся из геометрии окружности, глубина — из
    имени слоя, если источник её туда пишет."""
    ops: list[Operation] = []
    for prim in prims:
        entry = meta.get(prim.layer)
        depth = entry.depth if entry else None
        if prim.kind is PrimitiveKind.CIRCLE and prim.center is not None:
            if not outer.contains(ShPoint(prim.center)):
                continue
            ops.append(
                Operation(
                    semantic=LayerSemantic.DRILL,
                    kind="circle",
                    layer=prim.layer,
                    center=prim.center,
                    diameter=prim.diameter,
                    depth=depth,
                    closed=True,
                )
            )
        elif prim.points:
            # Присадка, нарисованная полилинией: диаметр из описанной окружности.
            poly = _to_polygon(list(prim.points) + [prim.points[0]])
            if poly is None or not outer.contains(poly.representative_point()):
                continue
            minx, miny, maxx, maxy = poly.bounds
            ops.append(
                Operation(
                    semantic=LayerSemantic.DRILL,
                    kind="circle",
                    layer=prim.layer,
                    center=(round((minx + maxx) / 2, 4), round((miny + maxy) / 2, 4)),
                    diameter=round((maxx - minx + maxy - miny) / 2, 4),
                    depth=depth,
                    closed=True,
                )
            )
    return ops


def _path_operations(
    prims: list[tuple[str, Primitive]], outer: Polygon, meta: dict[str, LayerMeta]
) -> list[Operation]:
    ops: list[Operation] = []
    for semantic, prim in prims:
        if not prim.points:
            continue
        probe = ShPoint(prim.points[len(prim.points) // 2])
        if not outer.contains(probe) and not outer.touches(probe):
            continue
        entry = meta.get(prim.layer)
        ops.append(
            Operation(
                semantic=semantic,
                kind="path",
                layer=prim.layer,
                points=list(prim.points),
                closed=prim.closed,
                depth=entry.depth if entry else None,
            )
        )
    return ops
