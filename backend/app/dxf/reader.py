"""Чтение DXF: разворачивание блоков, аппроксимация кривых, сводка по слоям."""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.document import Drawing
from ezdxf.path import make_path

from app.core.config_files import geometry_config, layer_presets
from app.dxf.model import DxfScan, LayerInfo, Primitive, PrimitiveKind
from app.models.enums import DxfSource

# Кривые (SPLINE, ELLIPSE, дуги в полилиниях) раскладываются в точки.
# Окружность остаётся окружностью — из неё берётся диаметр присадки.
_PATH_TYPES = {
    "LINE",
    "ARC",
    "LWPOLYLINE",
    "POLYLINE",
    "SPLINE",
    "ELLIPSE",
}
_TEXT_TYPES = {"TEXT", "MTEXT"}
_MAX_INSERT_DEPTH = 8


class DxfReadError(RuntimeError):
    pass


def read_file(path: str | Path) -> DxfScan:
    try:
        doc = ezdxf.readfile(str(path))
    except (OSError, ezdxf.DXFError) as exc:  # noqa: PERF203
        raise DxfReadError(f"Не удалось прочитать DXF: {exc}") from exc
    return scan_document(doc)


def scan_document(doc: Drawing) -> DxfScan:
    cfg = geometry_config()
    tol = float(cfg.get("spline_tolerance", 0.05))

    warnings: list[str] = []
    primitives: list[Primitive] = []
    for entity in _flatten(doc.modelspace(), depth=0, warnings=warnings):
        prim = _to_primitive(entity, tol, warnings)
        if prim is not None:
            primitives.append(prim)

    texts = [p.text for p in primitives if p.kind is PrimitiveKind.TEXT and p.text]
    acad = str(doc.header.get("$ACADVER", ""))
    return DxfScan(
        primitives=primitives,
        layers=summarize_layers(primitives),
        texts=texts,
        detected_source=detect_source(doc, primitives),
        acad_version=acad,
        warnings=warnings,
    )


def _flatten(container: Any, depth: int, warnings: list[str]):
    """Разворачивает INSERT в реальную геометрию, рекурсивно."""
    for entity in container:
        dxftype = entity.dxftype()
        if dxftype == "INSERT":
            if depth >= _MAX_INSERT_DEPTH:
                warnings.append(
                    f"Вложенность блоков превысила {_MAX_INSERT_DEPTH} — блок пропущен"
                )
                continue
            try:
                nested = list(entity.virtual_entities())
            except Exception as exc:  # блок может быть битым
                warnings.append(f"Не удалось развернуть блок: {exc}")
                continue
            yield from _flatten(nested, depth + 1, warnings)
        else:
            yield entity


def _to_primitive(entity: Any, tol: float, warnings: list[str]) -> Primitive | None:
    dxftype = entity.dxftype()
    layer = str(getattr(entity.dxf, "layer", "0"))

    if dxftype in _TEXT_TYPES:
        return Primitive(
            layer=layer,
            dxftype=dxftype,
            kind=PrimitiveKind.TEXT,
            text=_text_of(entity),
        )

    if dxftype == "CIRCLE":
        center = (float(entity.dxf.center.x), float(entity.dxf.center.y))
        return Primitive(
            layer=layer,
            dxftype=dxftype,
            kind=PrimitiveKind.CIRCLE,
            center=center,
            radius=float(entity.dxf.radius),
            closed=True,
            points=_circle_points(center, float(entity.dxf.radius), tol),
        )

    if dxftype not in _PATH_TYPES:
        return None

    try:
        path = make_path(entity)
    except Exception as exc:
        warnings.append(f"{dxftype} на слое «{layer}» не разобран: {exc}")
        return None

    # flattening() держит стрелку прогиба не больше tol — это и есть допуск
    # аппроксимации сплайнов и дуг из ТЗ.
    points = [(round(v.x, 6), round(v.y, 6)) for v in path.flattening(distance=tol)]
    points = _drop_consecutive_duplicates(points)
    if len(points) < 2:
        return None

    return Primitive(
        layer=layer,
        dxftype=dxftype,
        kind=PrimitiveKind.PATH,
        points=points,
        closed=bool(path.is_closed),
    )


def _text_of(entity: Any) -> str:
    if entity.dxftype() == "MTEXT":
        try:
            return str(entity.plain_text())
        except Exception:
            return str(getattr(entity, "text", ""))
    return str(getattr(entity.dxf, "text", ""))


def _circle_points(center: tuple[float, float], radius: float, tol: float) -> list:
    """Аппроксимация окружности с той же стрелкой прогиба, что и у кривых."""
    if radius <= 0:
        return []
    # Стрелка прогиба хорды: h = r * (1 - cos(a/2)).
    ratio = max(-1.0, min(1.0, 1.0 - tol / radius))
    step = 2.0 * math.acos(ratio) if radius > tol else math.pi / 4.0
    segments = max(8, int(math.ceil(2 * math.pi / step)))
    cx, cy = center
    return [
        (
            round(cx + radius * math.cos(2 * math.pi * i / segments), 6),
            round(cy + radius * math.sin(2 * math.pi * i / segments), 6),
        )
        for i in range(segments)
    ]


def _drop_consecutive_duplicates(points: list) -> list:
    out: list = []
    for pt in points:
        if not out or pt != out[-1]:
            out.append(pt)
    return out


def summarize_layers(primitives: list[Primitive]) -> list[LayerInfo]:
    """Сводка по слоям для мастера сопоставления: сколько примитивов,
    каких типов, какие диаметры окружностей, какой габарит."""
    buckets: dict[str, list[Primitive]] = defaultdict(list)
    for prim in primitives:
        buckets[prim.layer].append(prim)

    layers: list[LayerInfo] = []
    for name in sorted(buckets):
        prims = buckets[name]
        dxftypes: dict[str, int] = defaultdict(int)
        diameters: list[float] = []
        closed_paths = circles = texts = 0
        xs: list[float] = []
        ys: list[float] = []
        for prim in prims:
            dxftypes[prim.dxftype] += 1
            if prim.kind is PrimitiveKind.CIRCLE:
                circles += 1
                if prim.diameter is not None:
                    diameters.append(round(prim.diameter, 2))
            elif prim.kind is PrimitiveKind.TEXT:
                texts += 1
            elif prim.closed:
                closed_paths += 1
            for x, y in prim.points:
                xs.append(x)
                ys.append(y)
        bbox = (min(xs), min(ys), max(xs), max(ys)) if xs else None
        layers.append(
            LayerInfo(
                name=name,
                count=len(prims),
                dxftypes=dict(dxftypes),
                closed_paths=closed_paths,
                circles=circles,
                texts=texts,
                bbox=bbox,
                circle_diameters=sorted(set(diameters)),
            )
        )
    return layers


def detect_source(doc: Drawing, primitives: list[Primitive]) -> str:
    """Определение программы-экспортёра по сигнатуре файла.

    Используется заголовок ($ACADVER и прочие переменные) и эвристика по
    именам слоёв. Правила лежат в config/layer_presets.yaml — здесь только
    их применение.
    """
    import re

    cfg = layer_presets().get("source_detection", []) or []
    haystack = " ".join(
        str(value) for value in _header_values(doc)
    ) + " " + " ".join(sorted({p.layer for p in primitives}))

    best_source = DxfSource.UNKNOWN.value
    best_score = 0.0
    for entry in cfg:
        signals = entry.get("signals", {}) or {}
        score = 0.0
        for needle in signals.get("header_contains", []) or []:
            if needle.lower() in haystack.lower():
                score += 0.5
        pattern = signals.get("layer_name_regex")
        if pattern and any(re.search(pattern, p.layer) for p in primitives):
            score += 0.5
        score *= float(signals.get("weight", 1.0))
        if score > best_score:
            best_score, best_source = score, entry.get("source", DxfSource.UNKNOWN.value)

    return best_source if best_score > 0 else DxfSource.UNKNOWN.value


def _header_values(doc: Drawing) -> list[str]:
    keys = ("$ACADVER", "$LASTSAVEDBY", "$PROJECTNAME", "$MENU", "$FINGERPRINTGUID")
    values = []
    for key in keys:
        try:
            values.append(str(doc.header.get(key, "")))
        except Exception:
            continue
    return values
