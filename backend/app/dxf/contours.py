"""Разбор примитивов в детали: внешний контур, внутренние вырезы, операции.

Вложенность контуров определяется по геометрии (площадь + вхождение), а не
по слою — это требование для Fusion 360, где слоёв с семантикой нет вовсе.
"""

from __future__ import annotations

from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from app.core.config_files import geometry_config
from app.dxf.model import Operation, PartShape, Primitive, PrimitiveKind
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
        self.warnings: list[str] = []


def build_shapes(
    primitives: list[Primitive],
    semantic_by_layer: dict[str, str],
    *,
    default_semantic: str = LayerSemantic.OUTER,
) -> ContourResult:
    """Строит детали из примитивов.

    ``semantic_by_layer`` — результат применения пресета слоёв. Слои, для
    которых семантика не назначена, получают ``default_semantic``.
    """
    cfg = geometry_config()
    stitch_tol = float(cfg.get("stitch_tolerance", 0.01))
    dup_tol = float(cfg.get("duplicate_tolerance", 0.01))
    min_perimeter = float(cfg.get("min_contour_perimeter", 0.5))

    result = ContourResult()

    # (цепочка точек, замкнута ли она в исходном файле)
    contours: list[tuple[list, bool]] = []
    drill_prims: list[Primitive] = []
    op_prims: list[tuple[str, Primitive]] = []

    for prim in primitives:
        if prim.kind is PrimitiveKind.TEXT:
            continue
        semantic = semantic_by_layer.get(prim.layer, default_semantic)
        if semantic in _SKIP_SEMANTICS:
            continue
        if semantic == LayerSemantic.DRILL:
            drill_prims.append(prim)
            continue
        if semantic in _OPERATION_SEMANTICS:
            op_prims.append((semantic, prim))
            continue
        if semantic in _CONTOUR_SEMANTICS:
            if prim.kind is PrimitiveKind.CIRCLE:
                # Окружность на контурном слое — это круглый вырез, а не присадка.
                if len(prim.points) >= 3:
                    contours.append((list(prim.points) + [prim.points[0]], True))
                continue
            if len(prim.points) >= 2:
                contours.append((list(prim.points), prim.closed))

    chains = deduplicate(
        [c for c, _ in contours], dup_tol, [flag for _, flag in contours]
    )
    closed_rings, open_chains = stitch(chains, stitch_tol)

    if open_chains:
        result.warnings.append(
            f"Незакрытых контуров после сшивки: {len(open_chains)}. "
            "Проверьте разрывы в исходном DXF."
        )

    polygons: list[Polygon] = []
    for ring in closed_rings:
        if path_length(ring) < min_perimeter:
            continue
        poly = _to_polygon(ring)
        if poly is not None and poly.area > 0:
            polygons.append(poly)

    if not polygons:
        result.warnings.append("В файле не найдено ни одного замкнутого контура.")
        return result

    for outer_poly, hole_polys in _resolve_nesting(polygons):
        shape = PartShape(
            outer=list(outer_poly.exterior.coords),
            inners=[list(h.exterior.coords) for h in hole_polys],
            bbox=outer_poly.bounds,
            area=outer_poly.area - sum(h.area for h in hole_polys),
        )
        shape.operations.extend(_drill_operations(drill_prims, outer_poly))
        shape.operations.extend(_path_operations(op_prims, outer_poly))
        result.shapes.append(shape)

    if len(result.shapes) > 1:
        result.warnings.append(
            f"В файле {len(result.shapes)} независимых контуров — вероятно, "
            "несколько деталей в одном DXF."
        )
    return result


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


def _resolve_nesting(polygons: list[Polygon]) -> list[tuple[Polygon, list[Polygon]]]:
    """Определяет вложенность по площади и вхождению.

    Контур верхнего уровня = не лежит внутри другого. Контуры, лежащие
    непосредственно в нём, становятся его вырезами. Третий уровень
    вложенности (остров внутри выреза) снова становится деталью.
    """
    ordered = sorted(polygons, key=lambda p: p.area, reverse=True)
    depth: list[int] = []
    parent: list[int | None] = []

    for i, poly in enumerate(ordered):
        # Ближайший (наименьший по площади) контейнер среди больших контуров.
        container: int | None = None
        for j in range(i):
            if ordered[j].contains(poly.representative_point()):
                container = j
        depth.append(0 if container is None else depth[container] + 1)
        parent.append(container)

    groups: list[tuple[Polygon, list[Polygon]]] = []
    for i, poly in enumerate(ordered):
        if depth[i] % 2 != 0:
            continue  # нечётная глубина — это вырез, а не деталь
        holes = [
            ordered[j]
            for j in range(len(ordered))
            if parent[j] == i and depth[j] % 2 == 1
        ]
        groups.append((poly, holes))
    return groups


def _drill_operations(prims: list[Primitive], outer: Polygon) -> list[Operation]:
    """Присадка: диаметр берётся из геометрии окружности."""
    ops: list[Operation] = []
    for prim in prims:
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
                    closed=True,
                )
            )
    return ops


def _path_operations(
    prims: list[tuple[str, Primitive]], outer: Polygon
) -> list[Operation]:
    ops: list[Operation] = []
    for semantic, prim in prims:
        if not prim.points:
            continue
        probe = ShPoint(prim.points[len(prim.points) // 2])
        if not outer.contains(probe) and not outer.touches(probe):
            continue
        ops.append(
            Operation(
                semantic=semantic,
                kind="path",
                layer=prim.layer,
                points=list(prim.points),
                closed=prim.closed,
            )
        )
    return ops
