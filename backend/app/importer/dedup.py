"""Дедупликация деталей.

Одинаковые детали внутри одного изделия схлопываются в одну позицию с
количеством. Сравнивается геометрия, а не имя файла: в Fusion одна и та же
полка часто лежит в файлах ``Polka1.dxf``, ``Polka2.dxf``.

Нормализуется только перенос. Зеркальная деталь (бок левый / бок правый) и
повёрнутая на 90° деталь дублями НЕ считаются: для текстурных материалов это
разные детали, и объединять их нельзя.
"""

from __future__ import annotations

import hashlib

from app.core.config_files import app_config


def _quantize(points: list, tol: float, dx: float, dy: float) -> tuple:
    return tuple(
        (int(round((x - dx) / tol)), int(round((y - dy) / tol))) for x, y in points
    )


def _canonical_ring(points: list, tol: float, dx: float, dy: float) -> tuple:
    quant = list(_quantize(points, tol, dx, dy))
    if len(quant) > 1 and quant[0] == quant[-1]:
        quant = quant[:-1]
    if not quant:
        return ()
    start = min(range(len(quant)), key=lambda i: quant[i])
    return tuple(quant[start:] + quant[:start])


def geometry_signature(geometry: dict, thickness: float | None) -> str:
    """Отпечаток геометрии детали для поиска дублей."""
    tol = float(app_config().get("import", {}).get("dedup_tolerance", 0.1))
    outer = geometry.get("outer") or []
    if not outer:
        return ""

    bbox = geometry.get("bbox") or [0, 0, 0, 0]
    dx, dy = float(bbox[0]), float(bbox[1])

    parts: list[str] = [str(_canonical_ring(outer, tol, dx, dy))]
    inner_sigs = sorted(
        str(_canonical_ring(ring, tol, dx, dy)) for ring in geometry.get("inners") or []
    )
    parts.extend(inner_sigs)

    # Присадка и пазы тоже входят в отпечаток: детали с разной присадкой —
    # разные детали, даже если контур совпадает.
    op_sigs = sorted(
        "{}:{}:{}:{}".format(
            op.get("semantic"),
            op.get("diameter"),
            int(round((float(op["center"][0]) - dx) / tol)) if op.get("center") else "",
            int(round((float(op["center"][1]) - dy) / tol)) if op.get("center") else "",
        )
        for op in geometry.get("operations") or []
    )
    parts.extend(op_sigs)
    parts.append(f"t={thickness}")

    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:32]


def dedup_enabled() -> bool:
    return bool(app_config().get("import", {}).get("deduplicate_within_product", True))
