"""SVG serialisation of a Sheet (for the palette preview and .svg export)."""
from __future__ import annotations

from typing import List
from xml.sax.saxutils import escape

from .prims import Arc, Circle, DASHES, Line, Polygon, Polyline, Sheet, Text

FONT_FAMILY = "DejaVu Sans, Arial, Helvetica, sans-serif"


def _f(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".")


def _dash_attr(dash) -> str:
    if not dash:
        return ""
    return f' stroke-dasharray="{" ".join(_f(d) for d in DASHES.get(dash, [2, 1]))}"'


def _arc_path(cx: float, cy: float, r: float, a0: float, a1: float, H: float) -> str:
    import math
    while a1 < a0:
        a1 += 360.0
    sweep = a1 - a0
    x0, y0 = cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0))
    x1, y1 = cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1))
    large = 1 if sweep > 180 else 0
    # y is flipped on output: counter-clockwise in sheet space becomes sweep-flag 0 in SVG
    return f"M {_f(x0)} {_f(H - y0)} A {_f(r)} {_f(r)} 0 {large} 0 {_f(x1)} {_f(H - y1)}"


def sheet_to_svg(sheet: Sheet, embed_size: bool = True) -> str:
    W, H = sheet.width, sheet.height
    parts: List[str] = []
    size_attr = f' width="{_f(W)}mm" height="{_f(H)}mm"' if embed_size else ""
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_f(W)} {_f(H)}"{size_attr} '
                 f'font-family="{FONT_FAMILY}" stroke-linecap="round" stroke-linejoin="round">')
    parts.append(f'<rect x="0" y="0" width="{_f(W)}" height="{_f(H)}" fill="#ffffff"/>')
    for p in sheet.prims:
        if isinstance(p, Line):
            parts.append(f'<line x1="{_f(p.x1)}" y1="{_f(H - p.y1)}" x2="{_f(p.x2)}" y2="{_f(H - p.y2)}" '
                         f'stroke="#000" stroke-width="{_f(p.width)}"{_dash_attr(p.dash)}/>')
        elif isinstance(p, Polyline):
            pts = " ".join(f"{_f(x)},{_f(H - y)}" for x, y in p.points)
            tag = "polygon" if p.closed else "polyline"
            parts.append(f'<{tag} points="{pts}" fill="none" stroke="#000" stroke-width="{_f(p.width)}"{_dash_attr(p.dash)}/>')
        elif isinstance(p, Polygon):
            d = " ".join("M " + " L ".join(f"{_f(x)} {_f(H - y)}" for x, y in loop) + " Z" for loop in p.loops if loop)
            fill = p.fill or "none"
            stroke = f'stroke="#000" stroke-width="{_f(p.width)}"' if p.stroke else 'stroke="none"'
            parts.append(f'<path d="{d}" fill="{fill}" fill-rule="evenodd" {stroke}/>')
        elif isinstance(p, Circle):
            fill = p.fill or "none"
            parts.append(f'<circle cx="{_f(p.cx)}" cy="{_f(H - p.cy)}" r="{_f(p.r)}" fill="{fill}" stroke="#000" '
                         f'stroke-width="{_f(p.width)}"{_dash_attr(p.dash)}/>')
        elif isinstance(p, Arc):
            parts.append(f'<path d="{_arc_path(p.cx, p.cy, p.r, p.a0, p.a1, H)}" fill="none" stroke="#000" '
                         f'stroke-width="{_f(p.width)}"{_dash_attr(p.dash)}/>')
        elif isinstance(p, Text):
            anchor = {"start": "start", "middle": "middle", "end": "end"}.get(p.anchor, "start")
            weight = ' font-weight="bold"' if p.bold else ""
            baseline = ' dominant-baseline="central"' if p.valign == "middle" else ""
            transform = f' transform="rotate({_f(-p.rotate)} {_f(p.x)} {_f(H - p.y)})"' if p.rotate else ""
            parts.append(f'<text x="{_f(p.x)}" y="{_f(H - p.y)}" font-size="{_f(p.size)}" text-anchor="{anchor}"'
                         f'{weight}{baseline}{transform} fill="#000">{escape(p.text)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)
