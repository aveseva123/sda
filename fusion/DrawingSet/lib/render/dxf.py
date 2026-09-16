"""Minimal DXF R12 (AC1009) writer: LINE, CIRCLE, ARC, POLYLINE, TEXT on layers with linetypes.

R12 is chosen because every CAD/CAM reader accepts it and its structure has no handles or
object dictionaries to get wrong. Text is written in the ANSI_1251 code page (declared in the
header), which is what AutoCAD and ezdxf expect for Cyrillic in R12 files.
"""
from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

from .prims import Arc, Circle, Line, Polygon, Polyline, Sheet, Text

LAYERS = [  # name, color index, linetype
    ("GEOM", 7, "CONTINUOUS"),
    ("HIDDEN", 8, "DASHED"),
    ("CENTER", 4, "CENTER"),
    ("DIM", 1, "CONTINUOUS"),
    ("TEXT", 3, "CONTINUOUS"),
    ("FRAME", 7, "CONTINUOUS"),
    ("CONTOUR", 7, "CONTINUOUS"),
    ("HOLES", 5, "CONTINUOUS"),
    ("HOLES_BACK", 6, "DASHED"),
    ("BEND", 4, "CENTER"),
]


def _f(v: float) -> str:
    return f"{v:.4f}"


def _pair(code: int, value) -> str:
    return f"{code}\n{value}\n"


def _layer_for(p) -> str:
    layer = getattr(p, "layer", "GEOM") or "GEOM"
    dash = getattr(p, "dash", None)
    if dash == "hidden" and layer == "GEOM":
        return "HIDDEN"
    if dash == "center" and layer == "GEOM":
        return "CENTER"
    return layer


def _header() -> str:
    out = [_pair(0, "SECTION"), _pair(2, "HEADER"), _pair(9, "$ACADVER"), _pair(1, "AC1009"),
           _pair(9, "$DWGCODEPAGE"), _pair(3, "ANSI_1251"), _pair(9, "$INSUNITS"), _pair(70, 4), _pair(0, "ENDSEC")]
    return "".join(out)


def _tables() -> str:
    out = [_pair(0, "SECTION"), _pair(2, "TABLES")]
    # linetypes
    out += [_pair(0, "TABLE"), _pair(2, "LTYPE"), _pair(70, 3)]
    for name, desc, pattern in (("CONTINUOUS", "Solid line", []), ("DASHED", "Dashed __ __ __", [2.0, -1.0]),
                                ("CENTER", "Center ____ _ ____", [8.0, -1.5, 1.5, -1.5])):
        out += [_pair(0, "LTYPE"), _pair(2, name), _pair(70, 64), _pair(3, desc), _pair(72, 65),
                _pair(73, len(pattern)), _pair(40, _f(sum(abs(x) for x in pattern)))]
        out += [_pair(49, _f(x)) for x in pattern]
    out += [_pair(0, "ENDTAB")]
    # layers
    out += [_pair(0, "TABLE"), _pair(2, "LAYER"), _pair(70, len(LAYERS))]
    for name, color, ltype in LAYERS:
        out += [_pair(0, "LAYER"), _pair(2, name), _pair(70, 64), _pair(62, color), _pair(6, ltype)]
    out += [_pair(0, "ENDTAB")]
    # text style
    out += [_pair(0, "TABLE"), _pair(2, "STYLE"), _pair(70, 1), _pair(0, "STYLE"), _pair(2, "STANDARD"),
            _pair(70, 0), _pair(40, 0.0), _pair(41, 1.0), _pair(50, 0.0), _pair(71, 0), _pair(42, 2.5),
            _pair(3, "txt"), _pair(4, ""), _pair(0, "ENDTAB")]
    out += [_pair(0, "ENDSEC")]
    return "".join(out)


def _line(x1, y1, x2, y2, layer) -> str:
    return "".join([_pair(0, "LINE"), _pair(8, layer), _pair(10, _f(x1)), _pair(20, _f(y1)), _pair(30, "0.0"),
                    _pair(11, _f(x2)), _pair(21, _f(y2)), _pair(31, "0.0")])


def _polyline(points: Sequence[Tuple[float, float]], closed: bool, layer: str) -> str:
    out = [_pair(0, "POLYLINE"), _pair(8, layer), _pair(66, 1), _pair(70, 1 if closed else 0)]
    for x, y in points:
        out += [_pair(0, "VERTEX"), _pair(8, layer), _pair(10, _f(x)), _pair(20, _f(y)), _pair(30, "0.0")]
    out += [_pair(0, "SEQEND"), _pair(8, layer)]
    return "".join(out)


def _circle(cx, cy, r, layer) -> str:
    return "".join([_pair(0, "CIRCLE"), _pair(8, layer), _pair(10, _f(cx)), _pair(20, _f(cy)), _pair(30, "0.0"),
                    _pair(40, _f(r))])


def _arc(cx, cy, r, a0, a1, layer) -> str:
    return "".join([_pair(0, "ARC"), _pair(8, layer), _pair(10, _f(cx)), _pair(20, _f(cy)), _pair(30, "0.0"),
                    _pair(40, _f(r)), _pair(50, _f(a0)), _pair(51, _f(a1))])


TEXT_SUBST = {"⌀": "%%c", "×": "x", "…": "...", "—": "-", "–": "-", "°": "%%d", "±": "%%p", "«": '"', "»": '"'}


def dxf_text(text: str) -> str:
    for a, b in TEXT_SUBST.items():
        text = text.replace(a, b)
    return text.encode("cp1251", "replace").decode("cp1251")


def _text(t: Text, layer: str) -> str:
    just = {"start": 0, "middle": 1, "end": 2}.get(t.anchor, 0)
    y = t.y - (t.size * 0.35 if t.valign == "middle" else 0.0)
    out = [_pair(0, "TEXT"), _pair(8, layer), _pair(10, _f(t.x)), _pair(20, _f(y)), _pair(30, "0.0"),
           _pair(40, _f(t.size)), _pair(1, dxf_text(t.text)), _pair(50, _f(t.rotate)), _pair(7, "STANDARD")]
    if just:
        out += [_pair(72, just), _pair(11, _f(t.x)), _pair(21, _f(y)), _pair(31, "0.0")]
    return "".join(out)


def prims_to_entities(prims: Iterable) -> str:
    out: List[str] = []
    for p in prims:
        layer = _layer_for(p)
        if isinstance(p, Line):
            out.append(_line(p.x1, p.y1, p.x2, p.y2, layer))
        elif isinstance(p, Polyline):
            if len(p.points) >= 2:
                out.append(_polyline(p.points, p.closed, layer))
        elif isinstance(p, Polygon):
            for loop in p.loops:
                if len(loop) >= 2 and p.stroke:
                    out.append(_polyline(loop, True, layer))
        elif isinstance(p, Circle):
            out.append(_circle(p.cx, p.cy, p.r, layer))
        elif isinstance(p, Arc):
            out.append(_arc(p.cx, p.cy, p.r, p.a0, p.a1, layer))
        elif isinstance(p, Text):
            if p.text:
                out.append(_text(p, layer if layer != "GEOM" else "TEXT"))
    return "".join(out)


def sheet_to_dxf(sheet: Sheet) -> str:
    return prims_to_dxf(sheet.prims)


def prims_to_dxf(prims: Iterable) -> str:
    return (_header() + _tables() + _pair(0, "SECTION") + _pair(2, "ENTITIES") + prims_to_entities(prims)
            + _pair(0, "ENDSEC") + _pair(0, "EOF"))


DXF_ENCODING = "cp1251"


def write_dxf(path: str, prims: Iterable) -> None:
    with open(path, "w", encoding=DXF_ENCODING, errors="replace", newline="\n") as fh:
        fh.write(prims_to_dxf(prims))
